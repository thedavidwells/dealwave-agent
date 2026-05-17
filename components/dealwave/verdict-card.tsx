"use client";

// components/dealwave/verdict-card.tsx
//
// Renders the typed Verdict object emitted by the advisor step.
// Layout (top to bottom):
//   1. Outer variant-tinted card (green / amber / red wash by recommendation)
//   2. Banner row — dot + recommendation label + strategy chip + grade chip,
//      with the deal score on the right
//   3. Metric tile grid — uses the 1px-grid-gap trick to draw cell borders
//      via the container's background bleeding through
//   4. Severity 4+ risks block (only if present)
//   5. Narrative paragraph
//   6. Follow-up chips with staggered chip-pop animation
//
// We mirror the Verdict shape locally rather than importing the Zod schema
// directly, so the client bundle does not pull in Zod (already lives on the
// server route handler). Schema lives in lib/schemas/verdict.ts — keep in sync.

import { useEffect, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";

type Recommendation = "strong-deal" | "good-deal" | "investigate" | "pass";
type Strategy =
    | "wholesale"
    | "flip"
    | "buy-and-hold"
    | "brrrr"
    | "creative-finance"
    | "pass";
type Health = "strong" | "neutral" | "concern";
type MetricFormat =
    | "currency"
    | "currency-monthly"
    | "currency-thousands"
    | "percent"
    | "count"
    | "score";

interface MetricTileData {
    label: string;
    value: number;
    rangeLow?: number;
    rangeHigh?: number;
    format: MetricFormat;
    health: Health;
    context?: string;
}

interface RiskData {
    severity: number;
    message: string;
}

export interface Verdict {
    recommendation: Recommendation;
    recommendedStrategy: Strategy;
    headline: string;
    dealScore: number;
    dealGrade: "A" | "B" | "C" | "D" | "F";
    metrics: MetricTileData[];
    narrative: string;
    risks: RiskData[];
    dataConfidence: "high" | "medium" | "low";
    followUps: string[];
    shouldOfferSave: boolean;
}

// Variant palette for the outer card and banner dot/label.
// `good-deal` intentionally shares the green wash with `strong-deal` — the
// distinction is communicated via the banner label text, not the tint.
interface VariantTokens {
    bg: string; // outer card background (variant wash)
    border: string; // outer card border (variant @ ~0.2 alpha)
    bannerBorder: string; // 1px banner bottom border (~1/4 of outer border alpha)
    accent: string; // dot color + recommendation label text
    label: string; // human-readable banner label
}

const VARIANTS: Record<Recommendation, VariantTokens> = {
    "strong-deal": {
        bg: "rgba(34,197,94,0.035)",
        border: "rgba(34,197,94,0.2)",
        bannerBorder: "rgba(34,197,94,0.13)",
        accent: "var(--dw-green)",
        label: "Strong Buy",
    },
    "good-deal": {
        bg: "rgba(34,197,94,0.035)",
        border: "rgba(34,197,94,0.2)",
        bannerBorder: "rgba(34,197,94,0.13)",
        accent: "var(--dw-green)",
        label: "Good Deal",
    },
    investigate: {
        bg: "rgba(245,158,11,0.035)",
        border: "rgba(245,158,11,0.2)",
        bannerBorder: "rgba(245,158,11,0.13)",
        accent: "var(--dw-amber)",
        label: "Investigate",
    },
    pass: {
        bg: "rgba(239,68,68,0.035)",
        border: "rgba(239,68,68,0.2)",
        bannerBorder: "rgba(239,68,68,0.13)",
        accent: "var(--dw-red)",
        label: "Pass",
    },
};

// Health → text color for the metric value + a matching threshold pill tint.
// `tint` is the rgb triplet so callers can compose at arbitrary alphas.
const HEALTH_TINT: Record<Health, { color: string; rgb: string }> = {
    strong: { color: "var(--dw-green)", rgb: "34,197,94" },
    concern: { color: "var(--dw-red)", rgb: "239,68,68" },
    neutral: { color: "var(--dw-sub)", rgb: "255,255,255" },
};

// Health → tile background. Strong/concern get a subtle wash so the grid
// scans as a heatmap; neutral is the lightest possible surface.
const HEALTH_BG: Record<Health, string> = {
    strong: "rgba(34,197,94,0.07)",
    concern: "rgba(239,68,68,0.07)",
    neutral: "rgba(255,255,255,0.03)",
};

// Grade letter color in the banner chip — A/B = green, C = amber, D/F = red.
function gradeColor(grade: Verdict["dealGrade"]): string {
    if (grade === "A" || grade === "B") return "var(--dw-green)";
    if (grade === "C") return "var(--dw-amber)";
    return "var(--dw-red)";
}

// Humanize a strategy enum into Title Case with spaces.
// "buy-and-hold" → "Buy And Hold", "brrrr" → "Brrrr".
function humanizeStrategy(strategy: Strategy): string {
    return strategy
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

// Format a numeric value based on the tile's format field.
// Keeps display consistent across tiles and locale-aware.
function formatValue(value: number, format: MetricFormat): string {
    switch (format) {
        case "currency":
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
            }).format(value);
        case "currency-monthly":
            return (
                new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                }).format(value) + "/mo"
            );
        case "currency-thousands":
            return "$" + Math.round(value / 1000) + "K";
        case "percent":
            return new Intl.NumberFormat("en-US", {
                style: "percent",
                maximumFractionDigits: 1,
            }).format(value);
        case "count":
            return value.toString();
        case "score":
            return value + "/100";
        default:
            return value.toString();
    }
}

// Threshold pill text — derived from the tile label so the agent does not
// have to emit thresholds itself. Returns null when no threshold is
// well-defined for the label (e.g. ARV, rent estimates).
//
// WHY: thresholds make each tile self-explanatory at a glance without forcing
// the user to remember what "good" looks like for a wholesale spread vs flip
// profit. Match is case-insensitive substring; longer labels still hit.
function thresholdFor(label: string): string | null {
    const l = label.toLowerCase();
    if (l.includes("arv")) return null;
    if (l.includes("rent")) return null;
    if (l.includes("mao")) return "≤ asking";
    if (l.includes("repair")) return "≤ 20% ARV";
    if (l.includes("profit") || l.includes("spread")) return "≥ $50K";
    if (l.includes("score")) return "≥ 80";
    if (l.includes("equity")) return "≥ 75%";
    return null;
}

// Subtext under each tile value. Falls back to a generic direction
// indicator when the agent did not provide a custom context line —
// reserves vertical space so neutral tiles still align with strong/concern
// tiles on the same row.
function subtextFor(tile: MetricTileData): string {
    if (tile.context) return tile.context;
    if (tile.health === "strong") return "↑ above target";
    if (tile.health === "concern") return "↓ below target";
    return "";
}

export function VerdictCard({
    verdict,
    onFollowUp,
}: {
    verdict: Verdict;
    // Callback fired when a follow-up suggestion chip is clicked.
    // Page.tsx passes sendMessage so the chip text becomes a new user turn.
    onFollowUp?: (prompt: string) => void;
}) {
    const variant = VARIANTS[verdict.recommendation];
    const severeRisks = verdict.risks.filter((r) => r.severity >= 4);
    const showStrategy = verdict.recommendedStrategy !== "pass";

    // Cap the metric grid at 5 columns to match the design; below 5 metrics
    // we want one tile per column so the row fills edge-to-edge with no
    // awkward trailing gap.
    const columns = Math.min(5, verdict.metrics.length);

    // Staggered chip animation — chips are hidden for 400ms after mount,
    // then each chip starts its own pop animation at i * 55ms. We render
    // chips at opacity:0 initially and only attach the animation class once
    // `visible` flips so the animation actually runs (CSS animations only
    // play on mount). Cleanup the timer if the component unmounts mid-wait.
    const [chipsVisible, setChipsVisible] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setChipsVisible(true), 400);
        return () => clearTimeout(t);
    }, []);

    return (
        <div
            className="animate-fade-up my-3 overflow-hidden"
            style={{
                borderRadius: 7,
                border: `1px solid ${variant.border}`,
                background: variant.bg,
            }}
        >
            {/* Banner row — recommendation dot/label on the left, strategy +
                grade chips inline, deal score pinned to the right. The bottom
                border uses a quarter-strength variant tint so the divider
                reads as "part of the wash", not a hard rule. */}
            <div
                className="flex items-center justify-between gap-2"
                style={{
                    padding: "10px 15px",
                    borderBottom: `1px solid ${variant.bannerBorder}`,
                }}
            >
                <div className="flex items-center" style={{ gap: 8 }}>
                    {/* Variant dot — small color cue that survives even if
                        the wash is too subtle on some displays. */}
                    <span
                        aria-hidden
                        style={{
                            width: 7,
                            height: 7,
                            borderRadius: 999,
                            background: variant.accent,
                            flexShrink: 0,
                        }}
                    />

                    <span
                        style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: variant.accent,
                        }}
                    >
                        {variant.label}
                    </span>

                    {/* Strategy chip — omitted when the agent picked "pass"
                        as the strategy. The banner label already communicates
                        the pass verdict; doubling up with "Strategy: Pass" is
                        noise. */}
                    {showStrategy && (
                        <span
                            style={{
                                padding: "3px 10px",
                                borderRadius: 12,
                                background: "rgba(96,165,250,0.09)",
                                border: "1px solid rgba(96,165,250,0.22)",
                                color: "var(--dw-blue)",
                                fontSize: 12,
                                fontWeight: 500,
                                whiteSpace: "nowrap",
                            }}
                        >
                            Strategy:{" "}
                            {humanizeStrategy(verdict.recommendedStrategy)}
                        </span>
                    )}

                    {/* Grade chip — neutral surface, only the letter is
                        colored by grade so the chip itself stays calm in
                        the banner. */}
                    <span
                        title={`Data confidence: ${verdict.dataConfidence}`}
                        style={{
                            padding: "3px 10px",
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid var(--dw-border)",
                            color: "var(--dw-sub)",
                            fontSize: 11,
                            fontWeight: 500,
                            whiteSpace: "nowrap",
                        }}
                    >
                        Grade{" "}
                        <span
                            style={{
                                color: gradeColor(verdict.dealGrade),
                                fontWeight: 600,
                            }}
                        >
                            {verdict.dealGrade}
                        </span>
                    </span>
                </div>

                {/* Right cluster — deal score. Baseline alignment so the
                    "/100" suffix sits cleanly under the digit baseline. */}
                <div
                    className="flex items-baseline"
                    style={{ gap: 5, flexShrink: 0 }}
                >
                    <span style={{ fontSize: 11, color: "var(--dw-dim)" }}>
                        Deal score
                    </span>
                    <span
                        style={{
                            fontSize: 22,
                            fontWeight: 700,
                            color: "rgba(255,255,255,0.85)",
                            lineHeight: 1,
                        }}
                    >
                        {verdict.dealScore}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--dw-dim)" }}>
                        /100
                    </span>
                </div>
            </div>

            {/* Metric tile grid — the 1px gap + container background trick.
                Each cell has no border; the gaps reveal the container's
                --dw-border color, which reads as a clean 1px hairline between
                tiles. Overflow:hidden on the outer card hides the bleed at
                the rounded corners. */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                    gap: 1,
                    background: "var(--dw-border)",
                }}
                className="dw-metric-grid"
            >
                {verdict.metrics.map((tile, i) => {
                    const tint = HEALTH_TINT[tile.health];
                    const threshold = thresholdFor(tile.label);
                    const subtext = subtextFor(tile);
                    const subtextOpacity =
                        tile.health === "neutral" ? 0.5 : 0.6;

                    return (
                        <div
                            key={i}
                            style={{
                                position: "relative",
                                padding: "11px 12px",
                                background: HEALTH_BG[tile.health],
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                            }}
                        >
                            {/* Top row — label + threshold pill.
                                Reserved min-height so tiles with no
                                threshold pill keep their label vertically
                                aligned with neighbors. */}
                            <div
                                className="flex items-center justify-between"
                                style={{ gap: 4, minHeight: 16 }}
                            >
                                <span
                                    style={{
                                        fontSize: 10,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                        color: "var(--dw-dim)",
                                    }}
                                >
                                    {tile.label}
                                </span>

                                {threshold && (
                                    <span
                                        className="font-mono"
                                        style={{
                                            fontSize: 9,
                                            padding: "1px 4px",
                                            borderRadius: 2,
                                            background:
                                                "rgba(255,255,255,0.04)",
                                            color: `rgba(${tint.rgb},0.55)`,
                                            whiteSpace: "nowrap",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {threshold}
                                    </span>
                                )}
                            </div>

                            {/* Metric value — health-tinted, tabular-nums so
                                stacked numbers across tiles line up cleanly. */}
                            <div
                                className="tabular-nums"
                                style={{
                                    fontSize: 20,
                                    fontWeight: 600,
                                    color: tint.color,
                                    lineHeight: 1.1,
                                }}
                            >
                                {formatValue(tile.value, tile.format)}
                            </div>

                            {/* Subtext — agent-provided context if set, else
                                a generic direction hint. Always rendered at
                                min-height so neutral tiles do not collapse. */}
                            <div
                                style={{
                                    fontSize: 10,
                                    minHeight: 14,
                                    color: tint.color,
                                    opacity: subtext ? subtextOpacity : 0,
                                    lineHeight: 1.3,
                                }}
                            >
                                {subtext || " "}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Body — risks, narrative, and follow-up chips share the same
                horizontal padding as the banner so everything reads as one
                vertical column. */}
            <div style={{ padding: "12px 15px" }}>
                {/* Severity 4+ risks. Lower-severity flags are folded into the
                    narrative above by the advisor itself. */}
                {severeRisks.length > 0 && (
                    <div
                        style={{
                            padding: "11px 14px",
                            marginBottom: 12,
                            borderRadius: 7,
                            background: "rgba(245,158,11,0.04)",
                            border: "1px solid rgba(245,158,11,0.2)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                        }}
                    >
                        {severeRisks.map((risk, i) => (
                            <div
                                key={i}
                                className="flex items-start"
                                style={{ gap: 7 }}
                            >
                                <AlertTriangleIcon
                                    className="mt-0.5 size-4 shrink-0"
                                    style={{ color: "var(--dw-amber)" }}
                                />
                                <div
                                    style={{
                                        fontSize: 13,
                                        color: "rgba(255,255,255,0.8)",
                                        lineHeight: 1.5,
                                    }}
                                >
                                    {risk.message}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Narrative — model's plain-English summary. Uses real
                    numbers from analyze_deal / pull_comps (schema enforces
                    that constraint server-side). */}
                <p
                    style={{
                        fontSize: 14,
                        color: "var(--dw-sub)",
                        lineHeight: 1.65,
                        margin: 0,
                    }}
                >
                    {verdict.narrative}
                </p>

                {/* Follow-up chips — clickable, fire onFollowUp. Each chip
                    becomes a real user turn so the agent has full context
                    for the next step (no fake UI shortcuts). */}
                {verdict.followUps.length > 0 && onFollowUp && (
                    <div
                        className="flex flex-wrap"
                        style={{
                            gap: 6,
                            paddingTop: 10,
                            marginTop: 10,
                            borderTop: "1px solid var(--dw-border)",
                        }}
                    >
                        {verdict.followUps.map((prompt, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => onFollowUp(prompt)}
                                className={
                                    chipsVisible
                                        ? "dw-followup-chip animate-chip-pop"
                                        : "dw-followup-chip"
                                }
                                style={{
                                    padding: "5px 13px",
                                    borderRadius: 20,
                                    background: "rgba(255,255,255,0.05)",
                                    border: "1px solid var(--dw-border-md)",
                                    color: "var(--dw-sub)",
                                    fontSize: 12,
                                    cursor: "pointer",
                                    transition:
                                        "background 0.12s, border-color 0.12s, color 0.12s",
                                    // Hidden until the 400ms gate elapses;
                                    // then each chip pops in at i * 55ms.
                                    opacity: chipsVisible ? undefined : 0,
                                    animationDelay: chipsVisible
                                        ? `${i * 55}ms`
                                        : undefined,
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background =
                                        "rgba(255,255,255,0.09)";
                                    e.currentTarget.style.borderColor =
                                        "var(--dw-border-str)";
                                    e.currentTarget.style.color =
                                        "var(--dw-text)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background =
                                        "rgba(255,255,255,0.05)";
                                    e.currentTarget.style.borderColor =
                                        "var(--dw-border-md)";
                                    e.currentTarget.style.color =
                                        "var(--dw-sub)";
                                }}
                            >
                                {prompt}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Mobile responsive override — clamp the metric grid to 2
                columns below 640px so values stay readable on phones. */}
            <style jsx>{`
                @media (max-width: 640px) {
                    .dw-metric-grid {
                        grid-template-columns: repeat(2, 1fr) !important;
                    }
                }
            `}</style>
        </div>
    );
}
