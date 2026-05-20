// app/deals/page.tsx
//
// /deals — Saved Deals index. Dynamic streaming SSR with Suspense:
//   - Page chrome (header, page title, layout) renders server-side
//     immediately because it has no async dependencies.
//   - The deal cards (DealsGrid) are an async Server Component wrapped
//     in <Suspense>, so they stream in once the DealWave fetch resolves.
//     User sees the chrome instantly, then cards materialize.
//
// Rendering story for the project:
//   - /deals/[id] uses ISR (revalidate: 60) for a cacheable detail page.
//   - /deals uses dynamic streaming SSR + Suspense for a live per-account
//     list — staleness here would be a UX bug (save in chat, don't see
//     it on the index), so the list is always fresh per request.

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { dealWaveFetch } from "@/lib/dealwave-client";

// ─── Design tokens (match /deals/[id] for visual consistency) ──────────

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
    amber: "#f59e0b",
    blue: "#60a5fa",
} as const;

// ─── Data types ────────────────────────────────────────────────────────

interface DealListItem {
    id: string;
    address: string;
    name?: string | null;
    investment_strategy?: string | null;
    pipeline_status?: string | null;
    property_image_url?: string | null;
    deal_score_int?: number | null;
    last_analyzed_at?: string | null;
    speed_check?: {
        arv_estimate?: number | null;
        mao?: number | null;
        profit_spread?: number | null;
        deal_grade?: string | null;
    } | null;
}

// ─── Page ──────────────────────────────────────────────────────────────

export default function DealsIndexPage() {
    return (
        <div
            style={{
                width: "100vw",
                minHeight: "100vh",
                background: C.bg,
            }}
        >
            {/* ─── Header (STATIC — part of the prerendered shell) ────── */}
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

            {/* ─── Content (mix of static + streamed) ───────────────── */}
            <div
                style={{
                    maxWidth: 1100,
                    margin: "0 auto",
                    padding: "32px 24px",
                }}
            >
                {/* Title block — STATIC */}
                <div style={{ marginBottom: 24 }}>
                    <h1
                        style={{
                            fontFamily: C.font,
                            fontSize: 28,
                            fontWeight: 700,
                            color: C.text,
                            marginBottom: 6,
                            letterSpacing: -0.5,
                        }}
                    >
                        Saved Deals
                    </h1>
                    <p
                        style={{
                            fontFamily: C.font,
                            fontSize: 13,
                            color: C.sub,
                            lineHeight: 1.5,
                        }}
                    >
                        Every property the agent has analyzed and you&apos;ve
                        saved. Click any deal to see the full breakdown — comps,
                        Monte Carlo, AI verdict. <span style={{ color: C.dim }}>
                            Server-rendered page with a Suspense-streamed deal
                            list.
                        </span>
                    </p>
                </div>

                {/* Deal list — DYNAMIC, streamed via Suspense */}
                <Suspense fallback={<DealsGridSkeleton />}>
                    <DealsGrid />
                </Suspense>
            </div>
        </div>
    );
}

// ─── Async DealsGrid (the dynamic hole) ────────────────────────────────

async function DealsGrid() {
    const result = await dealWaveFetch<{
        deals: DealListItem[];
        next_cursor: string | null;
    }>("/deals?limit=50");

    if (!result.ok) {
        return (
            <div
                style={{
                    padding: "40px 16px",
                    background: C.sf,
                    border: `1px solid ${C.bd}`,
                    borderRadius: 7,
                    textAlign: "center",
                    fontFamily: C.font,
                    fontSize: 13,
                    color: C.sub,
                }}
            >
                Couldn&apos;t load your saved deals right now. Try refreshing.
            </div>
        );
    }

    const deals = result.data.deals ?? [];

    if (deals.length === 0) {
        return (
            <div
                style={{
                    padding: "60px 16px",
                    background: C.sf,
                    border: `1px dashed ${C.bd}`,
                    borderRadius: 7,
                    textAlign: "center",
                }}
            >
                <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 15,
                        fontWeight: 600,
                        color: C.text,
                        marginBottom: 6,
                    }}
                >
                    No saved deals yet
                </div>
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 13,
                        color: C.sub,
                        marginBottom: 18,
                    }}
                >
                    Run an analysis from the chat and approve a save to see deals
                    here.
                </div>
                <Link
                    href="/"
                    style={{
                        display: "inline-block",
                        padding: "8px 16px",
                        background: C.text,
                        color: "#000",
                        fontFamily: C.font,
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 4,
                        textDecoration: "none",
                    }}
                >
                    Go to chat →
                </Link>
            </div>
        );
    }

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 16,
            }}
        >
            {deals.map((d, i) => (
                // Priority loading on the FIRST card only — it's the LCP
                // element above the fold and lazy-loading it (the default
                // for next/image) measurably hurts our LCP score. Every
                // other card stays lazy so we don't waste bandwidth on
                // cards the user may never scroll to.
                <DealCard key={d.id} deal={d} priority={i === 0} />
            ))}
        </div>
    );
}

// ─── DealCard ──────────────────────────────────────────────────────────

function DealCard({
    deal,
    priority = false,
}: {
    deal: DealListItem;
    // True for the first card on the page — flags the image as the LCP
    // element so Next.js loads it eagerly instead of lazy-loading.
    priority?: boolean;
}) {
    const sc = deal.speed_check ?? {};
    const score = deal.deal_score_int ?? null;
    const arv = sc.arv_estimate ?? null;
    const mao = sc.mao ?? null;
    const spread = sc.profit_spread ?? null;
    const strategy = deal.investment_strategy ?? null;

    return (
        <Link
            href={`/deals/${deal.id}`}
            style={{
                display: "block",
                background: C.sf,
                border: `1px solid ${C.bd}`,
                borderRadius: 7,
                overflow: "hidden",
                textDecoration: "none",
                transition: "border-color 120ms ease, transform 120ms ease",
            }}
        >
            {/* Image (or gradient placeholder) */}
            <div
                style={{
                    aspectRatio: "16 / 9",
                    position: "relative",
                    background: deal.property_image_url
                        ? "#000"
                        : "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                }}
            >
                {deal.property_image_url ? (
                    <Image
                        src={deal.property_image_url}
                        alt={`Photo of ${deal.address}`}
                        fill
                        sizes="(max-width: 768px) 100vw, 360px"
                        style={{ objectFit: "cover" }}
                        // priority on the first card only — that's the LCP
                        // element. Next.js disables lazy loading and adds a
                        // <link rel="preload"> hint for prioritized images.
                        priority={priority}
                    />
                ) : (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: C.dim,
                            fontFamily: C.font,
                            fontSize: 12,
                        }}
                    >
                        📷 No image yet
                    </div>
                )}
                {/* Score badge */}
                {score != null && (
                    <div
                        style={{
                            position: "absolute",
                            top: 10,
                            right: 10,
                            padding: "4px 8px",
                            background: "rgba(0,0,0,0.7)",
                            backdropFilter: "blur(6px)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 4,
                            fontFamily: C.mono,
                            fontSize: 12,
                            fontWeight: 700,
                            color: scoreColor(score),
                        }}
                    >
                        {score}/100
                    </div>
                )}
            </div>

            {/* Body */}
            <div style={{ padding: "12px 14px" }}>
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 14,
                        fontWeight: 600,
                        color: C.text,
                        marginBottom: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {deal.address}
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 10,
                    }}
                >
                    {strategy && (
                        <span
                            style={{
                                padding: "2px 7px",
                                background: "rgba(96,165,250,0.1)",
                                border: "1px solid rgba(96,165,250,0.2)",
                                borderRadius: 4,
                                fontFamily: C.font,
                                fontSize: 10,
                                color: C.blue,
                            }}
                        >
                            {formatStrategy(strategy)}
                        </span>
                    )}
                    {deal.pipeline_status && (
                        <span
                            style={{
                                padding: "2px 7px",
                                background: "rgba(255,255,255,0.04)",
                                border: `1px solid ${C.bd}`,
                                borderRadius: 4,
                                fontFamily: C.font,
                                fontSize: 10,
                                color: C.sub,
                            }}
                        >
                            {deal.pipeline_status}
                        </span>
                    )}
                </div>

                {/* Tiny stat row */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: 1,
                        background: C.bd,
                        borderRadius: 4,
                        overflow: "hidden",
                    }}
                >
                    <MiniStat label="ARV" value={shortUSD(arv)} accent={C.green} />
                    <MiniStat label="MAO" value={shortUSD(mao)} accent={C.amber} />
                    <MiniStat
                        label="Spread"
                        value={shortUSD(spread)}
                        accent={
                            spread != null && spread > 0 ? C.green : C.sub
                        }
                    />
                </div>
            </div>
        </Link>
    );
}

function MiniStat({
    label,
    value,
    accent,
}: {
    label: string;
    value: string;
    accent: string;
}) {
    return (
        <div
            style={{
                padding: "8px 10px",
                background: "rgba(255,255,255,0.02)",
            }}
        >
            <div
                style={{
                    fontFamily: C.font,
                    fontSize: 9,
                    color: C.dim,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 1,
                }}
            >
                {label}
            </div>
            <div
                style={{
                    fontFamily: C.mono,
                    fontSize: 12,
                    fontWeight: 600,
                    color: accent,
                }}
            >
                {value}
            </div>
        </div>
    );
}

// ─── Skeleton (Suspense fallback) ──────────────────────────────────────

function DealsGridSkeleton() {
    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 16,
            }}
        >
            {Array.from({ length: 6 }).map((_, i) => (
                <div
                    key={i}
                    style={{
                        background: C.sf,
                        border: `1px solid ${C.bd}`,
                        borderRadius: 7,
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            aspectRatio: "16 / 9",
                            background: "rgba(255,255,255,0.03)",
                            animation: "dwpulse 1.6s ease-in-out infinite",
                        }}
                    />
                    <div style={{ padding: "12px 14px" }}>
                        <div
                            style={{
                                height: 14,
                                width: "70%",
                                background: "rgba(255,255,255,0.04)",
                                borderRadius: 3,
                                marginBottom: 8,
                                animation: "dwpulse 1.6s ease-in-out infinite",
                            }}
                        />
                        <div
                            style={{
                                height: 10,
                                width: "40%",
                                background: "rgba(255,255,255,0.03)",
                                borderRadius: 3,
                                marginBottom: 14,
                            }}
                        />
                        <div
                            style={{
                                height: 36,
                                width: "100%",
                                background: "rgba(255,255,255,0.03)",
                                borderRadius: 3,
                            }}
                        />
                    </div>
                </div>
            ))}
            <style>{`
                @keyframes dwpulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </div>
    );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function formatStrategy(s: string): string {
    return s
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

function shortUSD(n: number | null | undefined): string {
    if (n == null) return "—";
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(0)}k`;
    return `$${Math.round(n)}`;
}

function scoreColor(score: number): string {
    if (score >= 85) return C.green;
    if (score >= 70) return C.blue;
    if (score >= 50) return C.amber;
    return "#ef4444";
}
