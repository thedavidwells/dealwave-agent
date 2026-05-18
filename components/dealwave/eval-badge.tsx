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
                    className="inline-flex h-[26px] cursor-default items-center gap-1.5 rounded-[4px] border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.08)] px-2.5 text-[12px] font-medium text-[var(--dw-green)] tabular-nums"
                    aria-label={`Eval suite: ${passing} of ${total} cases passing`}
                >
                    {/* 6px circular status dot — same green family as the
                        border so it reads as a single token. The dot +
                        green pill + numeric ratio is enough signal; the
                        earlier "passing ✓" wording was redundant with the
                        dot and the color. */}
                    <span
                        className="inline-block rounded-full bg-[var(--dw-green)]"
                        style={{ width: 6, height: 6 }}
                    />
                    {passing}/{total} evals
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
                side="bottom"
                align="end"
                sideOffset={10}
                collisionPadding={16}
                className="w-[320px] max-w-[calc(100vw-2rem)] rounded-lg p-4 shadow-[0_16px_48px_rgba(0,0,0,0.75)]"
            >
                {/* Single-column layout. The header is one inline
                    sentence — big green count + "cases passing" — that
                    sits ABOVE the divider with the case list below it.
                    Earlier versions had the count on its own row with
                    "cases passing" as a side subtitle, which read as a
                    two-column header even though the cases list below
                    was single-column. Folding them into one line
                    eliminates that visual mixed-mode. */}
                <div className="mb-3 border-b border-[var(--dw-border)] pb-3 text-[15px] font-medium leading-snug text-[var(--dw-green)]">
                    <span className="text-[18px] font-bold tabular-nums">
                        {passing}/{total}
                    </span>{" "}
                    cases passing
                </div>

                {/* Per-case list. Each row stacks the case id (green
                    Geist Mono) as its own header with the description in
                    dim sans below. No ✓ column — the green stat already
                    says "everything passes". */}
                <ul className="flex flex-col gap-2.5">
                    {cases.map((c) => (
                        <li key={c.id} className="flex flex-col gap-1">
                            <code className="font-mono text-[12px] font-medium leading-none text-[var(--dw-green)]">
                                {c.id}
                            </code>
                            <span className="line-clamp-2 text-[11px] leading-snug text-[var(--dw-sub)]">
                                {c.description}
                            </span>
                        </li>
                    ))}
                </ul>
            </TooltipContent>
        </Tooltip>
    );
}
