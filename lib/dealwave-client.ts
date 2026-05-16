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
    } = {},
): Promise<DealWaveResult<T>> {
    // Implementation for fetching from DealWave API
    const url = `${API_BASE}${path}`;
    const method = options.method || "GET";

    // 30-second timeout for all DealWave API calls
    // Pipeline is REAPI + Zenrows + AVN -> can be slow sometimes, so we want to give it a bit of time.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
        const res = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
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
            return { ok: false, error: "Request timed out after 30 seconds" };
        }
        return {
            ok: false,
            error: err instanceof Error ? err.message : "Unknown network error",
        };
    } finally {
        clearTimeout(timeout);
    }
}
