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
