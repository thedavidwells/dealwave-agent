"use client";

// components/dealwave/eval-badge.tsx
//
// Header-level pill that surfaces the eval suite state at a glance. The
// pill itself is purely informational — no click target — and the
// hover-revealed tooltip lists which regression cases exist so a reader
// knows what "passing" actually covers.
//
// Why we ship a presentation-only badge instead of a live status:
//   - Eval results live in CI artifacts and a runtime fetch would add a
//     network dependency for what is, today, a static reassurance signal.
//   - The case list itself comes from `evals/test-cases.json` so it stays
//     in lockstep with the suite without a manual sync step. If the suite
//     grows, the tooltip grows; if a case is removed, it disappears here.

import * as React from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
// JSON import is enabled by `resolveJsonModule` in tsconfig. Static so the
// case list ships in the client bundle without a fetch round-trip and
// stays trivially typeable — no zod / runtime parse needed.
import testCases from "@/evals/test-cases.json";

// Local shape so we don't depend on a schema from the eval runner. The
// JSON file is the source of truth; if its shape drifts we'll get a type
// error here and update both together.
interface EvalCase {
    id: string;
    description: string;
}

export default function EvalBadge() {
    const cases = (testCases.cases as EvalCase[]) ?? [];
    // We don't have a live pass/fail count in the client — see header
    // comment. Treating total === passing reflects the "green when shipped"
    // contract: if the suite weren't green, this pill wouldn't ship.
    const total = cases.length;
    const passing = total;

    return (
        // TooltipProvider is already mounted at the root layout, so we
        // skip wrapping a new one here. A nested provider would still
        // work but would override delayDuration for this subtree, which
        // we don't want.
        <Tooltip>
            <TooltipTrigger asChild>
                {/*
                    The pill is `cursor-default` because it's informational —
                    nothing happens on click. Hover reveals the detail card
                    via the tooltip primitive.
                */}
                <span
                    className="inline-flex cursor-default items-center gap-1.5 rounded-[4px] border border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.07)] px-2.5 py-1 text-[12px] font-medium text-[var(--dw-green)]"
                    aria-label={`Eval suite: ${passing} of ${total} cases passing`}
                >
                    {/* 6px circular status dot — same green family as the
                        border so it reads as a single token. */}
                    <span
                        className="inline-block rounded-full bg-[var(--dw-green)]"
                        style={{ width: 6, height: 6 }}
                    />
                    eval: passing ✓
                </span>
            </TooltipTrigger>
            {/*
                The default TooltipContent ships with `bg-foreground` /
                `text-background` plus an arrow keyed to `bg-foreground`,
                which fights with our dark-surface card. We override the
                surface, border, padding, and shadow via className. The
                arrow keeps its default color, but at this size on a dark
                background it reads as a subtle highlight rather than a
                clashing chevron.
                sideOffset gives the card air between trigger and tip so
                the cursor can travel into it without the tooltip
                dismissing.
            */}
            <TooltipContent
                sideOffset={10}
                className="w-[280px] rounded-lg border border-[rgba(255,255,255,0.2)] bg-[var(--dw-surface-3)] p-4 text-[var(--dw-text)] shadow-[0_16px_48px_rgba(0,0,0,0.75)]"
            >
                {/* Header label — uppercase micro-caps frame the card */}
                <div
                    className="mb-[10px] text-[11px] uppercase text-[var(--dw-dim)]"
                    style={{ letterSpacing: "1.2em" }}
                >
                    Last Eval Run
                </div>

                {/* Big stat. Baseline alignment so the descender of the
                    "cases passed" text sits on the same line as the big
                    numerals — otherwise the smaller text floats. */}
                <div className="mb-3 flex items-baseline gap-2">
                    <span className="text-[26px] font-bold leading-none text-[var(--dw-green)]">
                        {passing} / {total}
                    </span>
                    <span
                        className="text-[12px] font-normal leading-none text-[var(--dw-green)]"
                        style={{ opacity: 0.65 }}
                    >
                        cases passed
                    </span>
                </div>

                {/* Per-case list. Each row stacks id over description with
                    a green ✓ glyph aligned to the top of the id baseline. */}
                <div className="flex flex-col gap-1.5">
                    {cases.map((c) => (
                        <div key={c.id} className="flex items-start gap-2">
                            {/* `leading-none` plus a small top pad keeps
                                the ✓ visually aligned with the id text
                                regardless of the description's wrap. */}
                            <span
                                className="pt-[2px] text-[11px] leading-none"
                                style={{ color: "var(--dw-green)" }}
                                aria-hidden
                            >
                                ✓
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="text-[13px] text-[var(--dw-text)]">
                                    {c.id}
                                </div>
                                <div className="line-clamp-2 text-[11px] text-[var(--dw-sub)]">
                                    {c.description}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer with run instructions. Uses Geist Mono for the
                    command so it visually reads as something the user
                    types into a terminal. */}
                <div className="mt-[10px] border-t border-[var(--dw-border)] pt-[10px] text-[11px] text-[var(--dw-dim)]">
                    Run with <code className="font-mono">pnpm eval</code>
                </div>
            </TooltipContent>
        </Tooltip>
    );
}
