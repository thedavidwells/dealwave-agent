// components/dealwave/comps-table.tsx
//
// Server Component. Fetches comparable sales from DealWave's `/api/v1/comps`
// at render time. Wrapped in <Suspense> by the parent page so this async
// boundary streams in after the static shell has already rendered.
//
// This is the "rendering primitives" demo in action:
//   - The deal record itself is fetched at the page boundary (ISR caches it)
//   - The comps fetch is its own Suspense boundary — slower call, but the
//     user sees the static shell + property info + deal header IMMEDIATELY
//     while comps stream in over the wire
//
// If the /comps endpoint fails (rate limit, address can't be resolved,
// network), we render an empty-state row rather than throwing. Failed
// comp pulls shouldn't blow up the entire detail page.

import { dealWaveFetch } from "@/lib/dealwave-client";

const C = {
    sf: "#111111",
    bd: "rgba(255,255,255,0.08)",
    text: "#fafafa",
    sub: "rgba(255,255,255,0.55)",
    dim: "rgba(255,255,255,0.28)",
    font: '"Geist", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"Geist Mono", monospace',
    green: "#22c55e",
};

interface Comp {
    address: string;
    price?: number;
    sqft?: number;
    beds?: number | null;
    baths?: number;
    daysOld?: number;
    days_on_market?: number;
}

interface CompsResponse {
    comps?: Comp[];
    median_price?: number;
    min_price?: number;
    max_price?: number;
    avg_price_per_sqft?: number;
    radius?: number;
    market?: string;
}

// ─── Skeleton (shown via Suspense fallback while comps stream in) ──────

export function CompsTableSkeleton() {
    return (
        <div
            style={{
                background: C.sf,
                border: `1px solid ${C.bd}`,
                borderRadius: 7,
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    padding: "12px 16px",
                    borderBottom: `1px solid ${C.bd}`,
                }}
            >
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 14,
                        fontWeight: 600,
                        color: C.text,
                    }}
                >
                    Comparable Sales
                </div>
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 11,
                        color: C.dim,
                        marginTop: 2,
                    }}
                >
                    Fetching from DealWave Comps API…
                </div>
            </div>
            <div style={{ padding: "0" }}>
                {Array.from({ length: 5 }).map((_, i) => (
                    <div
                        key={i}
                        style={{
                            padding: "10px 16px",
                            borderTop: i === 0 ? "none" : `1px solid ${C.bd}`,
                            display: "flex",
                            gap: 12,
                        }}
                    >
                        <div
                            style={{
                                height: 12,
                                width: "40%",
                                background: "rgba(255,255,255,0.04)",
                                borderRadius: 3,
                                animation: "pulse 1.6s ease-in-out infinite",
                            }}
                        />
                        <div
                            style={{
                                height: 12,
                                width: "12%",
                                background: "rgba(255,255,255,0.04)",
                                borderRadius: 3,
                            }}
                        />
                        <div
                            style={{
                                height: 12,
                                width: "12%",
                                background: "rgba(255,255,255,0.04)",
                                borderRadius: 3,
                            }}
                        />
                        <div
                            style={{
                                height: 12,
                                width: "8%",
                                background: "rgba(255,255,255,0.04)",
                                borderRadius: 3,
                            }}
                        />
                    </div>
                ))}
            </div>
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </div>
    );
}

// ─── Async data component ──────────────────────────────────────────────

export async function CompsTable({ address }: { address: string }) {
    // Tiny artificial delay so the Suspense streaming is observable to the
    // user — the comps call is fast (sub-second) on warm caches, but the
    // visible "skeleton → real data" transition is the demo moment. Remove
    // this if you want the absolute fastest render.
    // (Commented out — uncomment if streaming isn't visible enough.)
    // await new Promise((r) => setTimeout(r, 300));

    const result = await dealWaveFetch<CompsResponse>("/comps", {
        method: "POST",
        body: { address, radius: 1, limit: 10 },
    });

    if (!result.ok || !result.data?.comps?.length) {
        return (
            <div
                style={{
                    background: C.sf,
                    border: `1px solid ${C.bd}`,
                    borderRadius: 7,
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        padding: "12px 16px",
                        borderBottom: `1px solid ${C.bd}`,
                    }}
                >
                    <div
                        style={{
                            fontFamily: C.font,
                            fontSize: 14,
                            fontWeight: 600,
                            color: C.text,
                        }}
                    >
                        Comparable Sales
                    </div>
                </div>
                <div
                    style={{
                        padding: "32px 16px",
                        textAlign: "center",
                        fontFamily: C.font,
                        fontSize: 12,
                        color: C.dim,
                    }}
                >
                    No comparable sales available for this address right now.
                </div>
            </div>
        );
    }

    const comps = result.data.comps;
    const prices = comps
        .map((c) => c.price)
        .filter((p): p is number => typeof p === "number");
    const median = result.data.median_price ?? medianOf(prices);
    const minP = result.data.min_price ?? Math.min(...prices);
    const maxP = result.data.max_price ?? Math.max(...prices);
    const avgPerSqft = result.data.avg_price_per_sqft;

    return (
        <div
            style={{
                background: C.sf,
                border: `1px solid ${C.bd}`,
                borderRadius: 7,
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    padding: "12px 16px",
                    borderBottom: `1px solid ${C.bd}`,
                }}
            >
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 14,
                        fontWeight: 600,
                        color: C.text,
                    }}
                >
                    Comparable Sales
                </div>
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 11,
                        color: C.dim,
                        marginTop: 2,
                    }}
                >
                    {comps.length} properties
                    {result.data.radius
                        ? ` • ${result.data.radius} mi radius`
                        : ""}
                    {result.data.market ? ` • ${result.data.market}` : ""}
                </div>
            </div>
            <div style={{ overflowX: "auto" }}>
                <table
                    style={{
                        width: "100%",
                        borderCollapse: "collapse",
                    }}
                >
                    <thead>
                        <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                            {["Address", "Price", "Sqft", "Beds", "Baths", "Days"].map(
                                (h) => (
                                    <th
                                        key={h}
                                        style={{
                                            fontFamily: C.font,
                                            fontSize: 11,
                                            fontWeight: 500,
                                            color: C.dim,
                                            textAlign: "left",
                                            padding: "10px 16px",
                                            textTransform: "uppercase",
                                            letterSpacing: 0.5,
                                        }}
                                    >
                                        {h}
                                    </th>
                                ),
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {comps.map((c, i) => (
                            <tr
                                key={i}
                                style={{ borderTop: `1px solid ${C.bd}` }}
                            >
                                <td
                                    style={{
                                        fontFamily: C.font,
                                        fontSize: 12,
                                        color: C.text,
                                        padding: "10px 16px",
                                    }}
                                >
                                    {c.address}
                                </td>
                                <td
                                    style={{
                                        fontFamily: C.mono,
                                        fontSize: 12,
                                        color: C.green,
                                        padding: "10px 16px",
                                    }}
                                >
                                    {c.price ? `$${(c.price / 1000).toFixed(0)}k` : "—"}
                                </td>
                                <td
                                    style={{
                                        fontFamily: C.font,
                                        fontSize: 12,
                                        color: C.sub,
                                        padding: "10px 16px",
                                    }}
                                >
                                    {c.sqft?.toLocaleString() ?? "—"}
                                </td>
                                <td
                                    style={{
                                        fontFamily: C.font,
                                        fontSize: 12,
                                        color: C.sub,
                                        padding: "10px 16px",
                                    }}
                                >
                                    {c.beds ?? "—"}
                                </td>
                                <td
                                    style={{
                                        fontFamily: C.font,
                                        fontSize: 12,
                                        color: C.sub,
                                        padding: "10px 16px",
                                    }}
                                >
                                    {c.baths ?? "—"}
                                </td>
                                <td
                                    style={{
                                        fontFamily: C.font,
                                        fontSize: 12,
                                        color: C.dim,
                                        padding: "10px 16px",
                                    }}
                                >
                                    {(c.daysOld ?? c.days_on_market) != null
                                        ? `${c.daysOld ?? c.days_on_market}d`
                                        : "—"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div
                style={{
                    padding: "12px 16px",
                    borderTop: `1px solid ${C.bd}`,
                    background: "rgba(255,255,255,0.02)",
                }}
            >
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 11,
                        color: C.sub,
                    }}
                >
                    {median ? (
                        <>
                            <strong style={{ color: C.text }}>Median:</strong>{" "}
                            ${(median / 1000).toFixed(0)}k
                            {Number.isFinite(minP) && Number.isFinite(maxP) && (
                                <>
                                    {" • "}
                                    <strong style={{ color: C.text }}>
                                        Range:
                                    </strong>{" "}
                                    ${(minP / 1000).toFixed(0)}k–$
                                    {(maxP / 1000).toFixed(0)}k
                                </>
                            )}
                            {avgPerSqft && (
                                <>
                                    {" • "}
                                    <strong style={{ color: C.text }}>
                                        Avg $/sqft:
                                    </strong>{" "}
                                    ${Math.round(avgPerSqft)}
                                </>
                            )}
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function medianOf(arr: number[]): number | null {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
