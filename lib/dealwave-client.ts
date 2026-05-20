// lib/dealwave-client.ts
//
// Centralized DealWave API client. All agent tools that call DealWave
// go through this — keeps auth, timeouts, and error normalization in
// one place rather than scattered across each tool.

const API_BASE = process.env.DEALWAVE_API_BASE;
const TOKEN = process.env.DEALWAVE_API_TOKEN;

if (!API_BASE) {
    throw new Error(
        "DEALWAVE_API_BASE must be set in env. " +
            "Run: vercel env pull .env.local --environment=production",
    );
}

if (!TOKEN) {
    throw new Error(
        "DEALWAVE_API_TOKEN must be set in env. " +
            "Run: vercel env pull .env.local --environment=production",
    );
}

// Discriminated union: every DealWave call returns either ok+data or
// ok=false+error. The tool execute can switch on .ok to decide what
// to return to the model.
export type DealWaveResult<T> =
    | { ok: true; data: T; requestId?: string }
    | { ok: false; error: string; code?: string; status?: number };

export async function dealWaveFetch<T = unknown>(
    path: string,
    options: {
        method?: "GET" | "POST" | "PATCH" | "DELETE";
        body?: unknown;
        // Query-string params for GET requests. Undefined entries are
        // dropped before serialization so callers can pass an object
        // with optional fields without filtering it themselves.
        query?: Record<string, string | number | boolean | undefined>;
    } = {},
): Promise<DealWaveResult<T>> {
    // Implementation for fetching from DealWave API
    const method = options.method || "GET";
    const isGet = method === "GET";

    // Build the final URL. For GETs, fold any defined query params into
    // a URL-encoded querystring. Undefined values get dropped — caller
    // can hand us a partial Zod-parsed object and we'll Do The Right
    // Thing without making them filter first.
    let url = `${API_BASE}${path}`;
    if (options.query) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options.query)) {
            if (value === undefined) continue;
            params.append(key, String(value));
        }
        const qs = params.toString();
        if (qs) url += `?${qs}`;
    }

    // 60-second timeout for all DealWave API calls.
    // Pipeline is REAPI + Zenrows + AVM and (now) the image-fetch step
    // landed in /api/v1/analyze — observed real analyze calls taking
    // 30-45s end-to-end on cold cache after that change. Bumped from 30s
    // to give the slower pipeline headroom; the chat route's maxDuration
    // is 120s so multi-tool turns still have room for the advisor step.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
        // Build headers conditionally: GETs have no body, so a stray
        // Content-Type: application/json header is meaningless and some
        // gateways treat the combo as malformed. POSTs / PATCHes keep
        // the header so the body deserializes correctly.
        const headers: Record<string, string> = {
            Authorization: `Bearer ${TOKEN}`,
        };
        if (!isGet) headers["Content-Type"] = "application/json";

        const res = await fetch(url, {
            method,
            headers,
            body: !isGet && options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal,
        });

        // Pull rate-limit headers for observability and debugging,
        // but we don't need to do anything with them in the code right now.
        // DealWave API returns X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers.
        const rateLimit = {
            limit: Number(res.headers.get("X-RateLimit-Limit") || "0"),
            remaining: Number(res.headers.get("X-RateLimit-Remaining") || "0"),
            reset: Number(res.headers.get("X-RateLimit-Reset") || "0"),
        };
        console.debug(
            `DealWave API rate limit: ${rateLimit.remaining}/${rateLimit.limit}, resets in ${rateLimit.reset} seconds`,
        );

        if (!res.ok) {
            let errorMessage = res.statusText;
            let errorCode: string | undefined;
            try {
                const body = await res.json();
                errorMessage = body.error?.message ?? errorMessage;
                errorCode = body.error?.code;
            } catch {
                // body wasn't JSON
            }
            return {
                ok: false,
                error: errorMessage,
                code: errorCode,
                status: res.status,
            };
        }

        const body = await res.json();
        // DealWave response is { data, request_id } - unwrap for the caller
        return {
            ok: true,
            data: body.data as T,
            requestId: body.request_id,
        };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return { ok: false, error: "Request timed out after 60 seconds" };
        }
        return {
            ok: false,
            error: err instanceof Error ? err.message : "Unknown network error",
        };
    } finally {
        clearTimeout(timeout);
    }
}
