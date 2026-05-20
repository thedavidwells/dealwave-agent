// components/dealwave/what-if-histogram.tsx
//
// Renders the inline output of the run_what_if Sandbox tool — a profit
// distribution histogram plus a strip of percentile / risk stats.
//
// The histogram itself is a base64-encoded PNG produced inside the Sandbox
// by matplotlib (see lib/tools/run-what-if.ts → MONTECARLO_PYTHON). We
// render it via a data: URL so no server round-trip is needed.
//
// All metrics come from the tool's structured output. Numbers are formatted
// as compact USD with sensible coloring (median + upside green, downside +
// VaR red), mirroring the verdict card's health logic.

"use client";

// components/dealwave/what-if-histogram.tsx
//
// Two exports:
//   WhatIfHistogram   — pure data card (chart + stat tiles). No actions.
//   WhatIfFollowUps   — chip strip rendered SEPARATELY, always after all
//                       message text so it lands at the bottom of the turn.
//
// We deliberately keep these two components separate so the chip row
// never appears mid-message above the model's follow-up analysis text.
// The histogram is a tool part; tool parts render before text parts in
// the AI SDK message stream. If we put chips inside the card they'd
// always sit above whatever the model says next.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// The shape returned by the run_what_if tool's execute function. Kept loose
// because the AI SDK types tool outputs as `unknown` at the consumer.
export type RunWhatIfOutput = {
    ok: true;
    address?: string;
    trials: number;
    p10: number;
    p50: number;
    p90: number;
    expected_profit: number;
    probability_of_loss: number;
    value_at_risk_95: number;
    histogram_png_base64: string;
    interpretation?: string;
};

// Type predicate so the page renderer can narrow safely from the loose
// tool-output shape exposed by the SDK.
export function isRunWhatIfOutput(value: unknown): value is RunWhatIfOutput {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        v.ok === true &&
        typeof v.histogram_png_base64 === "string" &&
        typeof v.p50 === "number"
    );
}

function formatUSD(n: number): string {
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (abs >= 1000) {
        return `${sign}$${(abs / 1000).toFixed(1)}k`;
    }
    return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function Stat({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: "good" | "bad" | "neutral";
}) {
    return (
        <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {label}
            </div>
            <div
                className={cn(
                    "mt-0.5 font-mono text-sm tabular-nums",
                    tone === "good" && "text-emerald-400",
                    tone === "bad" && "text-rose-400",
                )}
            >
                {value}
            </div>
        </div>
    );
}

// Chip definitions for WhatIfFollowUps. Defined at module level so they
// don't re-allocate on every render.
const WHAT_IF_CHIPS: Array<{
    label: string;
    message: string;
    tone: "primary" | "default";
}> = [
    {
        label: "💾 Save to pipeline",
        message: "Save this deal to my pipeline",
        tone: "primary",
    },
    {
        label: "⚡ Stress test harder",
        message:
            "Re-run the Monte Carlo with aggressive assumptions — 25% ARV swing and 60% repair overrun",
        tone: "default",
    },
    {
        label: "📊 Pull comps",
        message: "Pull comps to validate the ARV estimate",
        tone: "default",
    },
];

// WhatIfHistogram — pure data display. No action chips.
// Chips live in WhatIfFollowUps (rendered separately after all message text).
export function WhatIfHistogram({ output }: { output: RunWhatIfOutput }) {
    const lossPct = output.probability_of_loss * 100;
    const lossTone =
        lossPct >= 20 ? "bad" : lossPct >= 5 ? "neutral" : "good";

    return (
        <div className="my-3 rounded-lg border border-border bg-card/60 p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
                <h4 className="text-sm font-medium">
                    Sensitivity analysis
                </h4>
                <span className="text-[11px] text-muted-foreground">
                    {output.trials.toLocaleString()} Monte Carlo trials ·
                    Sandbox · Python
                </span>
            </div>

            <img
                src={`data:image/png;base64,${output.histogram_png_base64}`}
                alt="Profit distribution histogram"
                className="w-full rounded-md"
            />

            <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat
                    label="P10 (downside)"
                    value={formatUSD(output.p10)}
                    tone={output.p10 < 0 ? "bad" : "neutral"}
                />
                <Stat
                    label="P50 (median)"
                    value={formatUSD(output.p50)}
                    tone={output.p50 > 0 ? "good" : "bad"}
                />
                <Stat
                    label="P90 (upside)"
                    value={formatUSD(output.p90)}
                    tone="good"
                />
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
                <Stat
                    label="P(loss)"
                    value={`${lossPct.toFixed(0)}%`}
                    tone={lossTone === "neutral" ? undefined : lossTone}
                />
                <Stat
                    label="95% VaR"
                    value={formatUSD(output.value_at_risk_95)}
                    tone={output.value_at_risk_95 < 0 ? "bad" : "neutral"}
                />
            </div>

            {output.interpretation && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                    {output.interpretation}
                </p>
            )}
        </div>
    );
}

// WhatIfFollowUps — action chips rendered AFTER all message text.
// Kept separate from WhatIfHistogram so the chip row always lands at the
// bottom of the assistant turn, below whatever prose the model streams.
// (Histogram is a tool part → always renders before text parts in the
// AI SDK message stream. Chips inside the card would appear mid-message.)
export function WhatIfFollowUps({
    onFollowUp,
    onNewAnalysis,
}: {
    onFollowUp: (text: string) => void;
    onNewAnalysis: () => void;
}) {
    // 350ms gate then staggered pop — mirrors VerdictCard chip animation
    // so the two card types feel like design siblings.
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setVisible(true), 350);
        return () => clearTimeout(t);
    }, []);

    return (
        <div
            className="flex flex-wrap"
            style={{
                gap: 6,
                paddingTop: 10,
                marginTop: 6,
                borderTop: "1px solid var(--dw-border)",
            }}
        >
            {WHAT_IF_CHIPS.map((chip, i) => (
                <button
                    key={chip.label}
                    type="button"
                    onClick={() => onFollowUp(chip.message)}
                    className={visible ? "dw-followup-chip animate-chip-pop" : "dw-followup-chip"}
                    style={{
                        padding: "5px 13px",
                        borderRadius: 20,
                        background:
                            chip.tone === "primary"
                                ? "rgba(34,197,94,0.08)"
                                : "rgba(255,255,255,0.05)",
                        border:
                            chip.tone === "primary"
                                ? "1px solid rgba(34,197,94,0.28)"
                                : "1px solid var(--dw-border-md)",
                        color:
                            chip.tone === "primary"
                                ? "var(--dw-green)"
                                : "var(--dw-sub)",
                        fontSize: 12,
                        cursor: "pointer",
                        transition: "background 0.12s, border-color 0.12s, color 0.12s",
                        opacity: visible ? undefined : 0,
                        animationDelay: visible ? `${i * 55}ms` : undefined,
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                            chip.tone === "primary"
                                ? "rgba(34,197,94,0.14)"
                                : "rgba(255,255,255,0.09)";
                        e.currentTarget.style.borderColor =
                            chip.tone === "primary"
                                ? "rgba(34,197,94,0.45)"
                                : "var(--dw-border-str)";
                        e.currentTarget.style.color =
                            chip.tone === "primary"
                                ? "var(--dw-green)"
                                : "var(--dw-text)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background =
                            chip.tone === "primary"
                                ? "rgba(34,197,94,0.08)"
                                : "rgba(255,255,255,0.05)";
                        e.currentTarget.style.borderColor =
                            chip.tone === "primary"
                                ? "rgba(34,197,94,0.28)"
                                : "var(--dw-border-md)";
                        e.currentTarget.style.color =
                            chip.tone === "primary"
                                ? "var(--dw-green)"
                                : "var(--dw-sub)";
                    }}
                >
                    {chip.label}
                </button>
            ))}

            {/* New analysis — muted/terminal style, animates last */}
            <button
                type="button"
                onClick={onNewAnalysis}
                className={visible ? "dw-followup-chip animate-chip-pop" : "dw-followup-chip"}
                style={{
                    padding: "5px 13px",
                    borderRadius: 20,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--dw-border)",
                    color: "var(--dw-dim)",
                    fontSize: 12,
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s, color 0.12s",
                    opacity: visible ? undefined : 0,
                    animationDelay: visible ? `${WHAT_IF_CHIPS.length * 55}ms` : undefined,
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.borderColor = "var(--dw-border-md)";
                    e.currentTarget.style.color = "var(--dw-sub)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    e.currentTarget.style.borderColor = "var(--dw-border)";
                    e.currentTarget.style.color = "var(--dw-dim)";
                }}
            >
                ↩ New analysis
            </button>
        </div>
    );
}
