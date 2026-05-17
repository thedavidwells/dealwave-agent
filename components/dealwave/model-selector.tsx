"use client";

// components/dealwave/model-selector.tsx
//
// Three small dropdowns the user can use to swap the AI Gateway models
// behind the chat:
//   - Research → the tool loop that pulls property data and runs comps
//   - Advisor  → the structured-output call that interprets data and
//                recommends a strategy
//   - Backup   → optional gateway provider fallback used only if the
//                primary provider is unavailable
//
// Selections persist in localStorage so a refresh keeps the user's choice.
// The current values are read by app/page.tsx and forwarded with every
// sendMessage call, where the server validates them against an allowlist
// (any unknown value falls back to the hardcoded default — see route.ts).

import * as React from "react";
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
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

// Keep these arrays in sync with the server-side allowlists in
// app/api/chat/route.ts. Server-side validation is the source of truth;
// these arrays just constrain what the UI offers.
export const RESEARCH_OPTIONS = [
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
] as const;

export const ADVISOR_OPTIONS = [
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-opus-4-6",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-4o",
] as const;

export const BACKUP_OPTIONS = ["none", "bedrock", "vertex"] as const;

export type ResearchModel = (typeof RESEARCH_OPTIONS)[number];
export type AdvisorModel = (typeof ADVISOR_OPTIONS)[number];
export type BackupProvider = (typeof BACKUP_OPTIONS)[number];

export interface ModelSelection {
    research: ResearchModel;
    advisor: AdvisorModel;
    backup: BackupProvider;
}

export const DEFAULT_MODELS: ModelSelection = {
    research: "anthropic/claude-haiku-4-5",
    advisor: "anthropic/claude-sonnet-4-6",
    backup: "none",
};

// Bumped to v2 when the field names changed. An older v1 blob in
// localStorage now misses every field and degrades cleanly to
// DEFAULT_MODELS via the field-by-field validation below.
const STORAGE_KEY = "dealwave.models.v2";

// Read the persisted selection from localStorage. Returns the defaults if
// nothing is stored or the stored value fails validation. We validate
// each field independently so a stale localStorage entry from a future/
// past version of the option lists degrades gracefully field-by-field.
function readPersisted(): ModelSelection {
    if (typeof window === "undefined") return DEFAULT_MODELS;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_MODELS;
        const parsed = JSON.parse(raw) as Partial<ModelSelection>;
        return {
            research: (RESEARCH_OPTIONS as readonly string[]).includes(
                parsed.research ?? "",
            )
                ? (parsed.research as ResearchModel)
                : DEFAULT_MODELS.research,
            advisor: (ADVISOR_OPTIONS as readonly string[]).includes(
                parsed.advisor ?? "",
            )
                ? (parsed.advisor as AdvisorModel)
                : DEFAULT_MODELS.advisor,
            backup: (BACKUP_OPTIONS as readonly string[]).includes(
                parsed.backup ?? "",
            )
                ? (parsed.backup as BackupProvider)
                : DEFAULT_MODELS.backup,
        };
    } catch {
        return DEFAULT_MODELS;
    }
}

// Hook that owns the selection state. Returns the current values plus a
// setter. Parent passes the values into sendMessage's options.body so each
// /api/chat request carries the user's choice.
export function useModelSelection() {
    // Initialize to defaults on the server so SSR and the first client
    // render match. After mount we hydrate from localStorage. Skipping
    // this dance produces a React hydration mismatch when the persisted
    // selection differs from defaults.
    const [models, setModels] = React.useState<ModelSelection>(DEFAULT_MODELS);

    React.useEffect(() => {
        setModels(readPersisted());
    }, []);

    const update = React.useCallback((next: Partial<ModelSelection>) => {
        setModels((prev) => {
            const merged = { ...prev, ...next };
            try {
                window.localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(merged),
                );
            } catch {
                // localStorage can throw under privacy modes or quota
                // exhaustion. The selection still applies for the current
                // session — we just lose persistence.
            }
            return merged;
        });
    }, []);

    return { models, update } as const;
}

// Strip the provider prefix for compact display in the trigger button
// (e.g. "anthropic/claude-haiku-4-5" → "claude-haiku-4-5"). The full
// string is still what gets sent to the gateway and shown in dropdown
// items — this is purely a visual nicety for the row of pills.
function shortLabel(modelId: string) {
    const slash = modelId.indexOf("/");
    return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

const TOOLTIPS = {
    research: "Pulls property data and runs comps",
    advisor: "Interprets data and recommends a strategy",
    backup: "Used if the primary provider is unavailable",
} as const;

export function ModelSelectorBar({
    models,
    onChange,
    className,
}: {
    models: ModelSelection;
    onChange: (next: Partial<ModelSelection>) => void;
    className?: string;
}) {
    return (
        // Single provider wraps all three tooltips — Radix's recommended
        // pattern. delayDuration=200 keeps tooltips snappy without being
        // hair-trigger.
        <TooltipProvider delayDuration={200}>
            <div
                className={
                    "flex flex-wrap items-center gap-2 " + (className ?? "")
                }
            >
                <ModelSelect
                    label="Research"
                    tooltip={TOOLTIPS.research}
                    value={models.research}
                    options={RESEARCH_OPTIONS}
                    onValueChange={(v) =>
                        onChange({ research: v as ResearchModel })
                    }
                />
                <ModelSelect
                    label="Advisor"
                    tooltip={TOOLTIPS.advisor}
                    value={models.advisor}
                    options={ADVISOR_OPTIONS}
                    onValueChange={(v) =>
                        onChange({ advisor: v as AdvisorModel })
                    }
                />
                <ModelSelect
                    label="Backup"
                    tooltip={TOOLTIPS.backup}
                    value={models.backup}
                    options={BACKUP_OPTIONS}
                    onValueChange={(v) =>
                        onChange({ backup: v as BackupProvider })
                    }
                    // The backup dropdown shows raw values (none/bedrock/vertex)
                    // since there's no provider prefix to strip.
                    displayRaw
                />
            </div>
        </TooltipProvider>
    );
}

function ModelSelect({
    label,
    tooltip,
    value,
    options,
    onValueChange,
    displayRaw,
}: {
    label: string;
    tooltip: string;
    value: string;
    options: readonly string[];
    onValueChange: (value: string) => void;
    displayRaw?: boolean;
}) {
    // Layout: <Select> stays the outermost wrapper because it's a Radix
    // context provider (not a DOM node). The Tooltip sits INSIDE the
    // Select, wrapping only the SelectTrigger — which is a real button
    // the tooltip primitive can attach hover/focus handlers to. Wrapping
    // the Select root with TooltipTrigger asChild silently no-ops (the
    // root isn't slottable), which is why an earlier pass appeared to
    // do nothing on hover.
    return (
        <Select value={value} onValueChange={onValueChange}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <SelectTrigger
                        size="sm"
                        className="h-7 gap-1.5 rounded-full border-dashed bg-transparent px-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                        aria-label={`${label} model`}
                    >
                        <span className="text-muted-foreground/70">
                            {label}
                        </span>
                        <span className="text-foreground/80 normal-case tracking-normal">
                            <SelectValue>
                                {displayRaw ? value : shortLabel(value)}
                            </SelectValue>
                        </span>
                    </SelectTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">{tooltip}</TooltipContent>
            </Tooltip>
            <SelectContent>
                {options.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                        {opt}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
