// app/deals/[id]/page.tsx
//
// Deal detail page — the destination of every "View this deal →" link
// emitted by the agent. Server Component for two reasons:
//   1. ISR — `revalidate = 60` caches the rendered HTML for a minute so
//      navigating between chat and detail feels instantaneous.
//   2. Streaming via Suspense — the comps section fetches from a separate
//      DealWave endpoint at render time, wrapped in <Suspense> so the
//      static shell + cached deal data render IMMEDIATELY while the comps
//      stream in. This is the "rendering strategies" demo: ISR for the
//      cacheable deal record, Suspense streaming for the fresher data
//      that benefits from being re-fetched on each navigation.
//
// Design fidelity: matches the Property Detail View handoff prototype.
// Visual tokens (#0a0a0a bg, #111 surface, rgba(255,255,255,0.08) borders,
// Geist font stack) are inlined here rather than relying on Tailwind so
// the styling is self-contained against the prototype's specs.

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import { dealWaveFetch } from "@/lib/dealwave-client";
import { AnalysisAccordion } from "@/components/dealwave/analysis-accordion";
import { CompsTable, CompsTableSkeleton } from "@/components/dealwave/comps-table";
import { MonteCarloPanel } from "@/components/dealwave/monte-carlo-panel";

// ISR — rebuild this page in the background at most once per 60 seconds.
// Saved deals are mostly read-mostly objects; a minute of staleness is
// well inside what feels "live" to a user clicking through from chat.
//
// (Previously this used `'use cache: remote'` + cacheTag + cacheLife
// under cacheComponents. Reverted to the classic revalidate export when
// we rolled cacheComponents back — same effective behavior, fewer
// constraints, no migration cost.)
export const revalidate = 60;

// Design tokens — kept inline so this page renders correctly even if
// global CSS hasn't loaded yet (e.g. during the static shell phase of
// streaming). Match the Property Detail View prototype 1:1.
const C = {
    bg: "#0a0a0a",
    sf: "#111111",
    sf2: "#161616",
    bd: "rgba(255,255,255,0.08)",
    bdMd: "rgba(255,255,255,0.13)",
    text: "#fafafa",
    sub: "rgba(255,255,255,0.55)",
    dim: "rgba(255,255,255,0.28)",
    font: '"Geist", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"Geist Mono", monospace',
    green: "#22c55e",
    red: "#ef4444",
    amber: "#f59e0b",
    blue: "#60a5fa",
} as const;

// ─── Data types ─────────────────────────────────────────────────────────

// What the DealWave API returns. Loose shape because the agent populates
// these incrementally — newer deals have richer speed_check JSONB.
interface SpeedCheck {
    arv_estimate?: number | null;
    arv_high?: number | null;
    arv_low?: number | null;
    mao?: number | null;
    estimated_repairs?: number | null;
    profit_spread?: number | null;
    deal_score?: number | null;
    deal_grade?: string | null;
    beds?: number | null;
    baths?: number | null;
    sqft?: number | null;
    year_built?: number | null;
    property_type?: string | null;
    lot_size?: number | null;
    confidence_score?: number | null;
    risk_flags?: Array<{ severity: number; message: string }> | null;
    monte_carlo?: {
        p10: number;
        p50: number;
        p90: number;
        probability_of_loss: number;
        value_at_risk_95: number;
        trials: number;
        histogram_png_base64?: string;
        interpretation?: string;
    } | null;
}

interface DealRecord {
    id: string;
    address: string;
    name?: string | null;
    notes?: string | null;
    // DealWave's curated v1 GET response exposes `deal_score_int` (typed
    // column on unified_deals). The grade is NOT a typed column — it lives
    // in speed_check.deal_grade. Until the DealWave PR exposes speed_check
    // in the GET response, we read score from the typed column and accept
    // grade missing.
    deal_score_int?: number | null;
    investment_strategy?:
        | "wholesale"
        | "flip"
        | "buy_and_hold"
        | "brrrr"
        | "creative_finance"
        | null;
    pipeline_status?: string | null;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    property_image_url?: string | null;
    // speed_check is currently filtered from the v1 API's curated GET
    // response (see DealResponseSchema in dealwave/api-deals.schema.ts).
    // Optional here in anticipation of the in-flight PR that exposes it.
    // Until that ships, this will always be undefined and the detail page
    // gracefully renders "—" for fields it can't find.
    speed_check?: SpeedCheck | null;
}

// ─── Formatters ────────────────────────────────────────────────────────

function formatStrategy(s: string): string {
    return s
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

function formatUSD(n: number | null | undefined): string {
    if (n == null) return "—";
    return `$${Math.round(n).toLocaleString()}`;
}

function gradeLabel(g?: string | null): string {
    if (!g) return "Grade —";
    return `Grade ${g}`;
}

// ─── Page ──────────────────────────────────────────────────────────────

export default async function DealDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const result = await dealWaveFetch<DealRecord>(`/deals/${id}`);
    if (!result.ok) notFound();
    const deal = result.data;
    const sc = deal.speed_check ?? {};

    // Tease the verdict label from the deal_grade — design wants a
    // recommendation pill ("Strong Buy", "Investigate", etc.). Map the
    // grade to a recommendation string roughly equivalent to the agent's
    // own recommendation enum. Grade lives in speed_check JSONB; falls
    // back to "Pending" until the DealWave API exposes that field.
    const recommendation = recommendationFromGrade(sc.deal_grade ?? null);

    // Pull out the high-severity risk flag (if any) for the warning
    // banner. Severity 4+ gets surfaced; lower-severity flags stay
    // implicit so the banner doesn't shout when it shouldn't.
    const topRisk = (sc.risk_flags ?? []).find((r) => r.severity >= 4);

    return (
        <div
            style={{
                width: "100vw",
                minHeight: "100vh",
                background: C.bg,
            }}
        >
            {/* ─── Header ──────────────────────────────────────────── */}
            <header
                style={{
                    padding: "11px 24px",
                    borderBottom: `1px solid ${C.bd}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                }}
            >
                <div
                    style={{
                        width: 28,
                        height: 28,
                        background: C.text,
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <span
                        style={{
                            fontFamily: C.font,
                            fontSize: 11,
                            color: "#000",
                            fontWeight: 700,
                        }}
                    >
                        DW
                    </span>
                </div>
                <span
                    style={{
                        fontFamily: C.font,
                        fontSize: 15,
                        color: "rgba(255,255,255,0.82)",
                        fontWeight: 500,
                    }}
                >
                    DealWave Agent
                </span>
                <Link
                    href="/"
                    style={{
                        marginLeft: "auto",
                        padding: "5px 11px",
                        background: C.sf,
                        border: `1px solid ${C.bd}`,
                        borderRadius: 4,
                        color: C.sub,
                        fontFamily: C.font,
                        fontSize: 12,
                        textDecoration: "none",
                    }}
                >
                    ← Back to chat
                </Link>
            </header>

            {/* ─── Hero Image ──────────────────────────────────────── */}
            <div
                style={{
                    height: 360,
                    background: deal.property_image_url
                        ? "#000"
                        : "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                    position: "relative",
                    overflow: "hidden",
                }}
            >
                {deal.property_image_url ? (
                    <Image
                        src={deal.property_image_url}
                        alt={`Photo of ${deal.address}`}
                        fill
                        priority
                        sizes="100vw"
                        style={{ objectFit: "cover" }}
                    />
                ) : (
                    <>
                        {/* Subtle grid overlay — matches the design's
                            "no image yet" placeholder style. Pure CSS,
                            no <img> request. */}
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                opacity: 0.4,
                                backgroundImage:
                                    "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
                                backgroundSize: "60px 60px",
                            }}
                        />
                        <div
                            style={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                transform: "translate(-50%, -50%)",
                                textAlign: "center",
                            }}
                        >
                            <div
                                style={{
                                    fontFamily: C.font,
                                    fontSize: 14,
                                    color: C.dim,
                                    marginBottom: 12,
                                }}
                            >
                                📷 Property Image
                            </div>
                            <div
                                style={{
                                    fontFamily: C.font,
                                    fontSize: 12,
                                    color: C.dim,
                                }}
                            >
                                Pending — captured on next analyze
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* ─── Content ─────────────────────────────────────────── */}
            <div
                style={{
                    maxWidth: 1100,
                    margin: "0 auto",
                    padding: "24px",
                }}
            >
                {/* Property Info Card */}
                <PropertyInfoCard deal={deal} sc={sc} />

                {/* Deal Header Card */}
                <DealHeaderCard
                    deal={deal}
                    sc={sc}
                    recommendation={recommendation}
                    topRisk={topRisk}
                />

                {/* AI Analysis (collapsible — interactive client child) */}
                {deal.notes && <AnalysisAccordion notes={deal.notes} />}

                {/* Two-column: Comps (left, streamed) + Monte Carlo (right) */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 16,
                    }}
                >
                    {/* Comps streams in via Suspense — the comps API call
                        runs at render time but doesn't block the static
                        shell. This is the visible "rendering primitives"
                        demo: ISR for the deal record + Suspense streaming
                        for the fresher data. */}
                    <Suspense fallback={<CompsTableSkeleton />}>
                        <CompsTable address={deal.address} />
                    </Suspense>

                    {/* Monte Carlo — only renders if saved with the deal.
                        Future enhancement: save the MC result inside
                        speed_check JSONB when run_what_if runs in chat. */}
                    <MonteCarloPanel data={sc.monte_carlo ?? null} />
                </div>
            </div>
        </div>
    );
}

// ─── Property Info Card ────────────────────────────────────────────────

function PropertyInfoCard({
    deal,
    sc,
}: {
    deal: DealRecord;
    sc: SpeedCheck;
}) {
    const items: Array<{ label: string; value: string }> = [
        { label: "Beds", value: fmtNum(sc.beds) },
        { label: "Baths", value: fmtNum(sc.baths) },
        { label: "Sqft", value: sc.sqft ? sc.sqft.toLocaleString() : "—" },
        { label: "Year", value: fmtNum(sc.year_built) },
        { label: "Type", value: sc.property_type ?? "—" },
        {
            label: "Lot",
            value: sc.lot_size
                ? `${(sc.lot_size / 1000).toFixed(1)}k sf`
                : "—",
        },
    ];

    return (
        <div
            style={{
                background: C.sf,
                border: `1px solid ${C.bd}`,
                borderRadius: 7,
                padding: "14px 16px",
                marginBottom: 16,
            }}
        >
            <div
                style={{
                    fontFamily: C.font,
                    fontSize: 18,
                    fontWeight: 600,
                    color: C.text,
                    marginBottom: 10,
                }}
            >
                {deal.address}
            </div>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: 16,
                }}
            >
                {items.map((i) => (
                    <div key={i.label}>
                        <div
                            style={{
                                fontFamily: C.font,
                                fontSize: 10,
                                color: C.dim,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                marginBottom: 3,
                            }}
                        >
                            {i.label}
                        </div>
                        <div
                            style={{
                                fontFamily: C.font,
                                fontSize: 15,
                                fontWeight: 500,
                                color: C.text,
                            }}
                        >
                            {i.value}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Deal Header Card ──────────────────────────────────────────────────

function DealHeaderCard({
    deal,
    sc,
    recommendation,
    topRisk,
}: {
    deal: DealRecord;
    sc: SpeedCheck;
    recommendation: { label: string; color: string };
    topRisk?: { severity: number; message: string };
}) {
    const metrics = [
        {
            label: "ARV",
            value: formatUSD(sc.arv_estimate),
            sub: "After Repair Value",
            color: sc.arv_estimate ? C.green : C.sub,
        },
        {
            label: "REPAIRS",
            value: formatUSD(sc.estimated_repairs),
            sub: "Est. scope & budget",
            color: C.sub,
        },
        {
            label: "EST. PROFIT",
            value: formatUSD(sc.profit_spread),
            sub: "After all costs",
            color: (sc.profit_spread ?? 0) > 0 ? C.green : C.sub,
        },
        {
            label: "MAO",
            value: formatUSD(sc.mao),
            sub: "Max allowable offer",
            color: sc.mao ? C.amber : C.sub,
        },
    ];

    return (
        <div
            style={{
                background: C.sf,
                border: `1px solid ${C.bd}`,
                borderRadius: 7,
                padding: "10px 16px 12px",
                marginBottom: 16,
            }}
        >
            {/* Top row */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                }}
            >
                <div
                    style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: recommendation.color,
                    }}
                />
                <span
                    style={{
                        fontFamily: C.font,
                        fontSize: 15,
                        fontWeight: 600,
                        color: recommendation.color,
                    }}
                >
                    {recommendation.label}
                </span>
                {deal.investment_strategy && (
                    <div
                        style={{
                            padding: "2px 8px",
                            background: "rgba(96,165,250,0.1)",
                            border: "1px solid rgba(96,165,250,0.2)",
                            borderRadius: 4,
                        }}
                    >
                        <span
                            style={{
                                fontFamily: C.font,
                                fontSize: 11,
                                color: C.blue,
                            }}
                        >
                            Strategy: {formatStrategy(deal.investment_strategy)}
                        </span>
                    </div>
                )}
                <div
                    style={{
                        padding: "2px 8px",
                        background: "rgba(255,255,255,0.05)",
                        border: `1px solid ${C.bd}`,
                        borderRadius: 4,
                    }}
                >
                    <span
                        style={{
                            fontFamily: C.font,
                            fontSize: 11,
                            color: C.sub,
                        }}
                    >
                        {gradeLabel(sc.deal_grade ?? null)}
                    </span>
                </div>
                <div
                    style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "baseline",
                        gap: 6,
                    }}
                >
                    <span
                        style={{
                            fontFamily: C.font,
                            fontSize: 11,
                            color: C.dim,
                        }}
                    >
                        Deal score
                    </span>
                    <span
                        style={{
                            fontFamily: C.font,
                            fontSize: 26,
                            fontWeight: 700,
                            color: C.text,
                        }}
                    >
                        {sc.deal_score ?? deal.deal_score_int ?? "—"}
                    </span>
                    <span
                        style={{
                            fontFamily: C.font,
                            fontSize: 11,
                            color: C.dim,
                        }}
                    >
                        /100
                    </span>
                </div>
            </div>

            {/* Metric grid */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 1,
                    background: C.bd,
                }}
            >
                {metrics.map((m) => (
                    <div
                        key={m.label}
                        style={{
                            padding: "11px 12px",
                            background: "rgba(255,255,255,0.02)",
                        }}
                    >
                        <div
                            style={{
                                fontFamily: C.font,
                                fontSize: 10,
                                color: C.dim,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                marginBottom: 4,
                            }}
                        >
                            {m.label}
                        </div>
                        <div
                            style={{
                                fontFamily: C.font,
                                fontSize: 22,
                                fontWeight: 600,
                                color: m.color,
                                marginBottom: 2,
                            }}
                        >
                            {m.value}
                        </div>
                        <div
                            style={{
                                fontFamily: C.font,
                                fontSize: 10,
                                color: C.dim,
                            }}
                        >
                            {m.sub}
                        </div>
                    </div>
                ))}
            </div>

            {/* Warning banner — only when there's a severity-4+ risk */}
            {topRisk && (
                <div
                    style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        background: "rgba(245,158,11,0.06)",
                        border: "1px solid rgba(245,158,11,0.2)",
                        borderLeft: `3px solid ${C.amber}`,
                        borderRadius: 5,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                        }}
                    >
                        <span style={{ fontSize: 14, marginTop: 1 }}>⚠️</span>
                        <div style={{ flex: 1 }}>
                            <div
                                style={{
                                    fontFamily: C.font,
                                    fontSize: 11,
                                    color: C.amber,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.7,
                                    fontWeight: 600,
                                    marginBottom: 3,
                                }}
                            >
                                Valuation Risk
                            </div>
                            <div
                                style={{
                                    fontFamily: C.font,
                                    fontSize: 12,
                                    color: C.sub,
                                    lineHeight: 1.5,
                                }}
                            >
                                {topRisk.message}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined): string {
    if (n == null) return "—";
    return String(n);
}

function recommendationFromGrade(
    g: string | null | undefined,
): { label: string; color: string } {
    switch (g) {
        case "A":
            return { label: "Strong Buy", color: C.green };
        case "B":
            return { label: "Good Buy", color: C.green };
        case "C":
            return { label: "Investigate", color: C.amber };
        case "D":
            return { label: "Caution", color: C.amber };
        case "F":
            return { label: "Pass", color: C.red };
        default:
            return { label: "Pending", color: C.sub };
    }
}
