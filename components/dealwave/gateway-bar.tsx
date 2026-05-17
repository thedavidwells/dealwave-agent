"use client";

// components/dealwave/gateway-bar.tsx
//
// Tiny status bar shown in the empty-state hero that surfaces the current
// gateway routing at a glance: which model handles research, which model
// handles the advisor step, the pass/fail ratio from the last eval run,
// and the number of tools currently wired up.
//
// Pure presentation: no state, no side effects. The parent owns the model
// selection (see model-selector.tsx) and just forwards the strings here.
//
// WHY the labels are "research" and "advisor": these are the two named
// pipeline steps the project standardized on. The earlier handoff used
// other names; do not reintroduce them — the chips are part of the user-
// facing chrome and must match the rest of the UI copy.

import { cn } from "@/lib/utils";

export type GatewayBarProps = {
    // Full gateway model id for the research step, e.g.
    // "anthropic/claude-haiku-4-5". The chip displays only the part after
    // the provider slash to keep the row compact.
    researchModel: string;
    // Full gateway model id for the advisor step.
    advisorModel: string;
    // Eval pass/fail summary from the most recent regression run. Surfaced
    // so the user can see at a glance whether the agent is currently
    // shipping all-green or has known failures.
    evalPassing?: number;
    evalTotal?: number;
    // Count of tools the agent has access to. Hardcoded default of 4
    // mirrors the current tool registry but the parent can override.
    toolCount?: number;
    className?: string;
};

// Strip the provider prefix for compact display. We keep the full string
// in the model selector dropdowns; this is purely a chrome niceity for
// the status row. Matches the same helper in model-selector.tsx — we keep
// a local copy rather than importing because this component is meant to
// stand alone (no coupling to the selector module).
function shortLabel(modelId: string): string {
    const slash = modelId.indexOf("/");
    return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

export default function GatewayBar({
    researchModel,
    advisorModel,
    evalPassing = 3,
    evalTotal = 3,
    toolCount = 4,
    className,
}: GatewayBarProps) {
    return (
        // 5px gap with flex-wrap so the four chips collapse onto a second
        // row on very narrow viewports rather than overflow horizontally.
        <div
            className={cn(
                "flex flex-row flex-wrap items-center gap-[5px]",
                className,
            )}
        >
            {/* Research chip — blue-tinted to match the design system's
                "primary action / data signal" color. Conveys that the
                research step is the active data-gathering leg. */}
            <span
                className="rounded-[4px] border px-[9px] py-[3px] font-sans text-[11px]"
                style={{
                    backgroundColor: "rgba(96, 165, 250, 0.08)",
                    borderColor: "rgba(96, 165, 250, 0.2)",
                    color: "var(--dw-blue)",
                }}
            >
                {shortLabel(researchModel)} · research
            </span>

            {/* Advisor chip — neutral surface, dim text. The advisor step
                is downstream of research and intentionally rendered as
                "supporting" chrome rather than a primary signal. */}
            <span
                className="rounded-[4px] border px-[9px] py-[3px] font-sans text-[11px]"
                style={{
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    borderColor: "var(--dw-border)",
                    color: "var(--dw-dim)",
                }}
            >
                {shortLabel(advisorModel)} · advisor
            </span>

            {/* Eval chip — green when passing. The check mark is a literal
                Unicode glyph rather than a Lucide icon so the chip stays
                inline-flow with the surrounding text (icons would force a
                flex container and throw off vertical alignment at 11px). */}
            <span
                className="rounded-[4px] border px-[9px] py-[3px] font-sans text-[11px]"
                style={{
                    backgroundColor: "rgba(34, 197, 94, 0.07)",
                    borderColor: "rgba(34, 197, 94, 0.2)",
                    color: "var(--dw-green)",
                }}
            >
                eval: {evalPassing} / {evalTotal} ✓
            </span>

            {/* Tools chip — same neutral surface as the advisor chip to
                visually group "configuration" signals away from the model
                identifiers. */}
            <span
                className="rounded-[4px] border px-[9px] py-[3px] font-sans text-[11px]"
                style={{
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    borderColor: "var(--dw-border)",
                    color: "var(--dw-dim)",
                }}
            >
                {toolCount} tools
            </span>
        </div>
    );
}
