"use client";

// components/dealwave/gateway-bar.tsx
//
// Status bar shown in the empty-state hero. Surfaces the current gateway
// routing at a glance AND lets the user swap models in place:
//   - Research chip → Select dropdown (blue tint)   — pulls property data
//   - Advisor chip  → Select dropdown (green tint)  — interprets, picks strategy
//   - Backup chip   → Select dropdown (purple tint) — provider fallback order
//   - Tools chip    → Tooltip listing the four registered tools
//
// Eval pass/fail intentionally NOT shown here — the header-level
// EvalBadge already surfaces that with a richer hover tooltip listing
// each case. Putting it in two places would just be noise.
//
// The interactive dropdowns share state with the chat-view ModelSelectorBar
// via the parent's useModelSelection hook. We accept models + callbacks via
// props rather than reaching into the hook here so the gateway bar stays
// composable (the parent can decide where the selection state lives).
//
// Falls back to read-only span rendering when no onChange callback is
// supplied — keeps the component usable as pure presentation in any
// surface that doesn't yet wire up model swaps.

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
    ADVISOR_OPTIONS,
    BACKUP_OPTIONS,
    RESEARCH_OPTIONS,
    type AdvisorModel,
    type BackupProvider,
    type ResearchModel,
} from "./model-selector";

export type GatewayBarProps = {
    researchModel: ResearchModel;
    advisorModel: AdvisorModel;
    backupProvider: BackupProvider;
    onResearchChange?: (model: ResearchModel) => void;
    onAdvisorChange?: (model: AdvisorModel) => void;
    onBackupChange?: (provider: BackupProvider) => void;
    className?: string;
};

// Short, accurate descriptions for each registered tool. Kept here rather
// than importing from lib/tools/* so we don't drag the AI SDK tool runtime
// into the client bundle just to read description strings. If a tool is
// added/removed, update this list AND the tools array in route.ts.
const TOOLS: ReadonlyArray<{ name: string; description: string }> = [
    {
        name: "analyze_deal",
        description:
            "Pulls property underwriting data — ARV, MAO, repairs, deal score, risk flags.",
    },
    {
        name: "pull_comps",
        description:
            "Fetches comparable sales to validate ARV. Auto-chains when confidence is low.",
    },
    {
        name: "run_what_if",
        description:
            "Monte Carlo simulation in a Vercel Sandbox — P10/P50/P90 profit, probability of loss.",
    },
    {
        name: "create_deal",
        description:
            "Saves a deal to your DealWave pipeline. Requires user approval.",
    },
    {
        name: "list_deals",
        description:
            "Lists saved deals from your pipeline. Filterable by status or stage.",
    },
];

// Tooltip copy on the model-selector chips. Mirrors the chat-footer
// ModelSelectorBar — same words so the two surfaces feel like one
// control.
const ROLE_TOOLTIPS = {
    research: "Pulls property data and runs comps",
    advisor: "Interprets data and recommends a strategy",
    backup: "Used if the primary provider is unavailable",
} as const;

// Strip the provider prefix for compact display. We keep the full string
// in the dropdown options; this is purely a chrome niceity.
function shortLabel(modelId: string): string {
    const slash = modelId.indexOf("/");
    return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

// Visual tokens per chip role. Centralized so the static and interactive
// branches stay pixel-identical — when a static chip becomes selectable
// via onChange, the only thing that changes is the wrapping element.
type ChipTheme = {
    background: string;
    border: string;
    color: string;
};

const RESEARCH_THEME: ChipTheme = {
    background: "rgba(96, 165, 250, 0.08)", // blue
    border: "rgba(96, 165, 250, 0.25)",
    color: "var(--dw-blue)",
};

const ADVISOR_THEME: ChipTheme = {
    background: "rgba(34, 197, 94, 0.08)", // green
    border: "rgba(34, 197, 94, 0.25)",
    color: "var(--dw-green)",
};

const BACKUP_THEME: ChipTheme = {
    background: "rgba(167, 139, 250, 0.08)", // purple
    border: "rgba(167, 139, 250, 0.25)",
    color: "var(--dw-purple)",
};

const TOOLS_THEME: ChipTheme = {
    background: "rgba(255, 255, 255, 0.04)",
    border: "var(--dw-border)",
    color: "var(--dw-dim)",
};

// Every chip — static span, Select trigger, tooltip trigger — uses
// CHIP_CLASS_BASE so they all land on the exact same 24px box.
//
//   - `!h-[24px]`: bang/important is REQUIRED — shadcn's SelectTrigger
//     ships `data-[size=default]:h-8` which Tailwind's twMerge does NOT
//     recognize as a height conflict against a plain `h-[24px]`. Without
//     `!` the Select chips render at 32px while the static span renders
//     at 24px, which is the exact "boxes aren't the same size" bug.
//   - `inline-flex items-center`: vertical centering for both the role
//     label + model name spans AND the shadcn chevron.
//   - `gap-1.5`: 6px between the role label and the model name.
//   - `[&_svg]:!size-2.5 [&_svg]:opacity-50`: shrink shadcn's default
//     16px chevron down to 10px and dim it. Bang on size for the same
//     twMerge reason — shadcn sets `[&_svg:not([class*='size-'])]:size-4`
//     which our `[&_svg]:size-2.5` doesn't override on the SelectValue's
//     icon descendant unless we use important.
//
// NOTE: chip-specific min-widths live on each rendered chip, not here.
// See MODEL_CHIP_MIN_WIDTH / TOOLS_CHIP_MIN_WIDTH below for the values
// and the reasoning.
const CHIP_CLASS_BASE =
    "inline-flex !h-[28px] items-center justify-center gap-1.5 rounded-[4px] border px-[12px] py-0 font-sans text-[12px] leading-none whitespace-nowrap";
const CHIP_TRIGGER_CLASS = `${CHIP_CLASS_BASE} cursor-pointer transition-colors outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&_svg]:!size-2.5 [&_svg]:opacity-50 hover:brightness-125`;

// Width-stability constants. The earlier code set a too-small
// `min-w-[88px]` on every chip, which meant the chip would CONTRACT
// when the user picked a shorter model (e.g. `gpt-4o` after
// `claude-sonnet-4-6`) — a real CLS regression every time a user opened
// a dropdown.
//
// Fix: reserve enough width per chip-type for its widest possible
// content. The width is the same for all three model chips so the row
// reads as a uniform set; the tools chip can stay narrow because its
// content never changes.
//
// MODEL_CHIP_MIN_WIDTH = 220px is calibrated for "RESEARCH · claude-
// sonnet-4-6 ▾" at 10px+12px Geist sans + 12px padding either side +
// 10px chevron. Measured on a real render; +10px slack so future
// slightly-longer model names still fit without a width jump. Bumped
// from 196px when the chip text scale went from 11px → 12px.
//
// Backup chip is narrower (144px) because its value pool is short
// ("none" / "bedrock" / "vertex") and the wider model-chip width with
// "BACKUP · none" centered would look hollow.
const MODEL_CHIP_MIN_WIDTH = "min-w-[220px]";
const BACKUP_CHIP_MIN_WIDTH = "min-w-[144px]";
const TOOLS_CHIP_MIN_WIDTH = "min-w-[96px]";

// Composed role-first chip body. The role label (uppercase, dim) prefixes
// the model so the chip telegraphs "FOR which step" before "WHICH model".
// Backup chip's "none" value renders as italic muted to read as "not set".
function ChipBody({
    role,
    model,
    isMuted,
}: {
    role: string;
    model: string;
    isMuted?: boolean;
}) {
    return (
        <>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] opacity-65">
                {role}
            </span>
            <span className="opacity-30">·</span>
            <span
                className={cn(
                    "text-[12px]",
                    isMuted && "italic opacity-60",
                )}
            >
                {shortLabel(model)}
            </span>
        </>
    );
}

// Static span renderer. Used when no onChange callback is supplied,
// and as the visual template for the interactive Select trigger.
// Accepts an optional minWidthClass so callers can pin width-stable
// dimensions matching the corresponding interactive chip.
function StaticChip({
    children,
    theme,
    minWidthClass = MODEL_CHIP_MIN_WIDTH,
}: {
    children: React.ReactNode;
    theme: ChipTheme;
    minWidthClass?: string;
}) {
    return (
        <span
            className={`${CHIP_CLASS_BASE} ${minWidthClass}`}
            style={{
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.color,
            }}
        >
            {children}
        </span>
    );
}

// Generic interactive chip — wraps a shadcn Select styled to match the
// static chip exactly. Used for research, advisor, AND backup with role-
// specific theming. The Tooltip wraps the SelectTrigger (not the Select
// root, which is a Radix context provider and not slottable) so hover
// handlers actually attach.
function SelectChip<T extends string>({
    value,
    options,
    onValueChange,
    role,
    theme,
    ariaLabel,
    tooltip,
    isMuted,
    minWidthClass = MODEL_CHIP_MIN_WIDTH,
}: {
    value: T;
    options: readonly T[];
    onValueChange: (v: T) => void;
    role: string;
    theme: ChipTheme;
    ariaLabel: string;
    tooltip: string;
    isMuted?: boolean;
    minWidthClass?: string;
}) {
    return (
        <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <SelectTrigger
                        className={`${CHIP_TRIGGER_CLASS} ${minWidthClass}`}
                        style={{
                            backgroundColor: theme.background,
                            borderColor: theme.border,
                            color: theme.color,
                        }}
                        aria-label={ariaLabel}
                    >
                        <SelectValue>
                            <ChipBody
                                role={role}
                                model={value}
                                isMuted={isMuted}
                            />
                        </SelectValue>
                    </SelectTrigger>
                </TooltipTrigger>
                <TooltipContent
                    side="top"
                    className="bg-[var(--dw-surface-3)] border border-[var(--dw-border-str)] text-[var(--dw-text)]"
                >
                    {tooltip}
                </TooltipContent>
            </Tooltip>
            <SelectContent
                className="bg-[var(--dw-surface-3)] border-[var(--dw-border-str)]"
                align="start"
            >
                {options.map((opt) => (
                    <SelectItem key={opt} value={opt} className="text-[12px]">
                        {opt}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export default function GatewayBar({
    researchModel,
    advisorModel,
    backupProvider,
    onResearchChange,
    onAdvisorChange,
    onBackupChange,
    className,
}: GatewayBarProps) {
    return (
        <div
            className={cn(
                "flex flex-row flex-wrap items-center justify-center gap-[5px]",
                className,
            )}
        >
            {/* Research chip — blue. Interactive when callback supplied. */}
            {onResearchChange ? (
                <SelectChip
                    value={researchModel}
                    options={RESEARCH_OPTIONS}
                    onValueChange={onResearchChange}
                    role="research"
                    theme={RESEARCH_THEME}
                    ariaLabel="Research model"
                    tooltip={ROLE_TOOLTIPS.research}
                />
            ) : (
                <StaticChip theme={RESEARCH_THEME}>
                    <ChipBody role="research" model={researchModel} />
                </StaticChip>
            )}

            {/* Advisor chip — green. */}
            {onAdvisorChange ? (
                <SelectChip
                    value={advisorModel}
                    options={ADVISOR_OPTIONS}
                    onValueChange={onAdvisorChange}
                    role="advisor"
                    theme={ADVISOR_THEME}
                    ariaLabel="Advisor model"
                    tooltip={ROLE_TOOLTIPS.advisor}
                />
            ) : (
                <StaticChip theme={ADVISOR_THEME}>
                    <ChipBody role="advisor" model={advisorModel} />
                </StaticChip>
            )}

            {/* Backup chip — purple. Value is "none" / "bedrock" / "vertex";
                "none" displays muted-italic so it reads as "off" without
                the user having to know the providers. Uses the narrower
                BACKUP_CHIP_MIN_WIDTH since the value pool is short. */}
            {onBackupChange ? (
                <SelectChip
                    value={backupProvider}
                    options={BACKUP_OPTIONS}
                    onValueChange={onBackupChange}
                    role="backup"
                    theme={BACKUP_THEME}
                    ariaLabel="Backup provider"
                    tooltip={ROLE_TOOLTIPS.backup}
                    isMuted={backupProvider === "none"}
                    minWidthClass={BACKUP_CHIP_MIN_WIDTH}
                />
            ) : (
                <StaticChip
                    theme={BACKUP_THEME}
                    minWidthClass={BACKUP_CHIP_MIN_WIDTH}
                >
                    <ChipBody
                        role="backup"
                        model={backupProvider}
                        isMuted={backupProvider === "none"}
                    />
                </StaticChip>
            )}

            {/* Tools chip — hover reveals the tool registry. Same chip
                dimensions as the model selectors above so the row reads
                as a uniform set. */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={`${CHIP_CLASS_BASE} ${TOOLS_CHIP_MIN_WIDTH} cursor-default`}
                        style={{
                            backgroundColor: TOOLS_THEME.background,
                            borderColor: TOOLS_THEME.border,
                            color: TOOLS_THEME.color,
                        }}
                        aria-label={`${TOOLS.length} tools — hover for details`}
                    >
                        {TOOLS.length} tools
                    </span>
                </TooltipTrigger>
                <TooltipContent
                    side="top"
                    sideOffset={10}
                    className="w-[320px] rounded-lg border border-[rgba(255,255,255,0.2)] bg-[var(--dw-surface-3)] p-4 text-[var(--dw-text)] shadow-[0_16px_48px_rgba(0,0,0,0.75)]"
                >
                    <ul className="flex flex-col gap-3">
                        {TOOLS.map((t) => (
                            <li key={t.name} className="flex flex-col gap-1">
                                <code className="font-mono text-[12px] font-medium text-[var(--dw-blue)]">
                                    {t.name}
                                </code>
                                <span className="text-[12px] leading-snug text-[var(--dw-sub)]">
                                    {t.description}
                                </span>
                            </li>
                        ))}
                    </ul>
                </TooltipContent>
            </Tooltip>
        </div>
    );
}
