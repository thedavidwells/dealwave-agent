"use client";

// components/dealwave/tool-pill.tsx
//
// Compact pill-style renderer for AI SDK v6 tool parts. Replaces the
// heavier <Tool>/<ToolHeader>/<ToolContent> card stack with a horizontal
// strip of small chips — one per tool call — that expand into a shared
// JSON panel below the row. Click a chip to peek at its input/output;
// click again to collapse.
//
// Two exports:
//   - <ToolPill />       — single chip
//   - <ToolPillStrip />  — labeled row of pills + the expanded JSON panel
//
// The parent owns the AI SDK plumbing (calling getToolName, reading
// part.input/output/state). We just take normalized props so the
// component is decoupled from the SDK version.

import { Loader2 } from "lucide-react";
import { useState } from "react";

// ---------- Types ----------------------------------------------------------

// Mirror the AI SDK v6 tool-part state union. Kept inline (not imported)
// so this component has zero compile-time coupling to the `ai` package —
// callers map their SDK state to this string union.
export type ToolPillState =
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error"
    | "approval-requested";

export type ToolPillProps = {
    // Tool name with the `tool-` prefix already stripped. We don't call
    // getToolName ourselves because the caller already has the SDK helpers
    // wired up and knows how to disambiguate static vs dynamic tools.
    toolName: string;
    state: ToolPillState;
    isExpanded: boolean;
    onToggle: () => void;
};

export type ToolPart = {
    toolCallId: string;
    toolName: string;
    state: ToolPillState;
    input: unknown;
    output?: unknown;
    errorText?: string;
};

export type ToolPillStripProps = {
    parts: ToolPart[];
    // Controlled expansion API. If both are supplied, the parent owns
    // expansion state (useful when expansion should persist across
    // message re-renders or be shared with other UI). Otherwise the
    // strip manages its own internal useState.
    expandedToolCallId?: string | null;
    onToggleExpanded?: (id: string | null) => void;
    className?: string;
};

// ---------- Variant helpers ------------------------------------------------

// Centralize the per-state color choices so ToolPill and the JSON panel
// can both reference the same source of truth without drifting.
type Variant = "default" | "approval" | "error";

function variantFor(state: ToolPillState): Variant {
    if (state === "approval-requested") return "approval";
    if (state === "output-error") return "error";
    return "default";
}

// Inline styles for chip bg/border. We use inline style objects rather
// than Tailwind classes because the spec calls for exact rgba values
// that aren't in the default Tailwind palette — and the values are
// state-driven (bg shifts when expanded), so a CSS variable swap is
// the cleanest expression.
function chipColors(
    variant: Variant,
    isExpanded: boolean,
): { background: string; borderColor: string; color: string } {
    if (variant === "approval") {
        return {
            background: "rgba(245,158,11,0.09)",
            borderColor: "rgba(245,158,11,0.28)",
            color: "var(--dw-amber)",
        };
    }
    if (variant === "error") {
        return {
            background: "rgba(239,68,68,0.07)",
            borderColor: "rgba(239,68,68,0.2)",
            color: "var(--dw-red)",
        };
    }
    // Default (any non-error, non-approval state). Background and border
    // both deepen on expansion so the active chip reads as "selected"
    // against the inactive ones.
    return {
        background: isExpanded
            ? "rgba(96,165,250,0.14)"
            : "rgba(96,165,250,0.07)",
        borderColor: isExpanded
            ? "rgba(96,165,250,0.38)"
            : "rgba(96,165,250,0.16)",
        color: "var(--dw-blue)",
    };
}

// ---------- ToolPill -------------------------------------------------------

export function ToolPill({
    toolName,
    state,
    isExpanded,
    onToggle,
}: ToolPillProps) {
    const variant = variantFor(state);
    const colors = chipColors(variant, isExpanded);

    // Pick the status glyph: green check on success, amber warn for
    // approval, red warn for error, spinner while the call is still
    // flowing through input-streaming / input-available.
    let statusNode: React.ReactNode;
    if (state === "output-available") {
        statusNode = (
            <span
                aria-hidden
                className="text-[11px] leading-none"
                style={{ color: "var(--dw-green)" }}
            >
                ✓
            </span>
        );
    } else if (state === "approval-requested") {
        statusNode = (
            <span
                aria-hidden
                className="text-[11px] leading-none"
                style={{ color: "var(--dw-amber)" }}
            >
                ⚠
            </span>
        );
    } else if (state === "output-error") {
        statusNode = (
            <span
                aria-hidden
                className="text-[11px] leading-none"
                style={{ color: "var(--dw-red)" }}
            >
                ⚠
            </span>
        );
    } else {
        // input-streaming | input-available — call still in flight.
        statusNode = <Loader2 className="size-3 animate-spin" aria-hidden />;
    }

    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            className="inline-flex items-center gap-[6px] rounded-full font-mono text-[12.5px] leading-none"
            style={{
                padding: "6px 13px",
                borderWidth: 1,
                borderStyle: "solid",
                background: colors.background,
                borderColor: colors.borderColor,
                color: colors.color,
                // 0.12s transition on the two properties that animate when
                // the chip toggles expanded state. Color of text is stable
                // so we skip it from the transition list.
                transition: "background 0.12s, border-color 0.12s",
            }}
        >
            {/* Lightning glyph — design's chosen "tool call" mark. Kept as a
                literal character (not an emoji) so it inherits chip color. */}
            <span aria-hidden className="text-[12px] leading-none">
                ⚡
            </span>
            <span className="leading-none">{toolName}</span>
            {statusNode}
            {/* Chevron — small triangle hinting expand/collapse. 10px keeps
                it visually subordinate to the tool name. */}
            <span
                aria-hidden
                className="text-[10px] leading-none"
                style={{ color: "var(--dw-dim)" }}
            >
                {isExpanded ? "▲" : "▼"}
            </span>
        </button>
    );
}

// ---------- JSON view ------------------------------------------------------

// Render one primitive JSON value with a type-appropriate color.
// Objects/arrays fall back to JSON.stringify — we don't recurse because
// the design only formalizes the top level (one-key-per-line). Nested
// structures land as raw text in --dw-sub so they're legible but visually
// receded compared to the labeled top-level keys.
function ValueNode({ value }: { value: unknown }) {
    if (value === null) {
        return (
            <span style={{ color: "var(--dw-dim)" }}>null</span>
        );
    }
    if (typeof value === "string") {
        return (
            <span style={{ color: "var(--dw-green)" }}>
                {`"${value}"`}
            </span>
        );
    }
    if (typeof value === "number") {
        return (
            <span style={{ color: "var(--dw-amber)" }}>{String(value)}</span>
        );
    }
    if (typeof value === "boolean") {
        return (
            <span style={{ color: "var(--dw-red)" }}>{String(value)}</span>
        );
    }
    // Objects, arrays, anything else — pretty-print with 2-space indent so
    // it stays readable inside the line. `white-space: pre-wrap` lets the
    // newlines from JSON.stringify actually render as newlines.
    let serialized: string;
    try {
        serialized = JSON.stringify(value, null, 2);
    } catch {
        serialized = String(value);
    }
    return (
        <span
            style={{
                color: "var(--dw-sub)",
                whiteSpace: "pre-wrap",
            }}
        >
            {serialized}
        </span>
    );
}

// Detect "is this a plain object we should render key-by-key?". Arrays
// are excluded so they render as JSON blobs through the non-object
// fallback below — the spec only describes per-key rendering for objects.
function isPlainObject(v: unknown): v is Record<string, unknown> {
    return (
        typeof v === "object" &&
        v !== null &&
        !Array.isArray(v) &&
        Object.getPrototypeOf(v) === Object.prototype
    );
}

function JSONView({ data }: { data: unknown }) {
    // Non-object (array, primitive, undefined) → dump as a single string.
    // We never crash on weird shapes; the agent occasionally returns
    // arrays directly from tools like pull_comps.
    if (!isPlainObject(data)) {
        let serialized: string;
        try {
            serialized = JSON.stringify(data, null, 2);
        } catch {
            serialized = String(data);
        }
        return (
            <pre
                className="font-mono text-[12px]"
                style={{
                    color: "var(--dw-sub)",
                    lineHeight: 1.8,
                    margin: 0,
                    whiteSpace: "pre-wrap",
                }}
            >
                {serialized}
            </pre>
        );
    }

    const entries = Object.entries(data);

    return (
        <div
            className="font-mono text-[12px]"
            style={{ lineHeight: 1.8 }}
        >
            <div style={{ color: "var(--dw-dim)" }}>{"{"}</div>
            {entries.map(([key, value], i) => {
                const isLast = i === entries.length - 1;
                return (
                    <div
                        key={key}
                        style={{ paddingLeft: 14 }}
                    >
                        <span style={{ color: "var(--dw-blue)" }}>
                            {`"${key}"`}
                        </span>
                        <span style={{ color: "var(--dw-dim)" }}>: </span>
                        <ValueNode value={value} />
                        {!isLast && (
                            <span style={{ color: "var(--dw-dim)" }}>,</span>
                        )}
                    </div>
                );
            })}
            <div style={{ color: "var(--dw-dim)" }}>{"}"}</div>
        </div>
    );
}

// ---------- Expanded panel -------------------------------------------------

function ExpandedPanel({ part }: { part: ToolPart }) {
    // Output section content depends on the part's state. We branch up
    // front so the JSX below stays declarative.
    let outputContent: React.ReactNode;
    if (part.state === "approval-requested") {
        outputContent = (
            <div
                className="text-[12px] italic"
                style={{ color: "var(--dw-amber)" }}
            >
                Awaiting user approval
            </div>
        );
    } else if (part.state === "output-error") {
        outputContent = (
            <pre
                className="font-mono text-[12px]"
                style={{
                    color: "var(--dw-red)",
                    margin: 0,
                    whiteSpace: "pre-wrap",
                }}
            >
                {part.errorText ?? "Unknown error"}
            </pre>
        );
    } else if (part.state === "output-available") {
        outputContent = <JSONView data={part.output} />;
    } else {
        // input-streaming | input-available — tool hasn't produced a result
        // yet. "Pending…" reads as a non-error wait state.
        outputContent = (
            <div
                className="text-[12px]"
                style={{ color: "var(--dw-sub)" }}
            >
                Pending…
            </div>
        );
    }

    return (
        <div
            className="animate-fade-up"
            style={{
                background: "var(--dw-surface-2)",
                border: "1px solid var(--dw-border-md)",
                borderRadius: 7,
                padding: "14px 16px",
                maxWidth: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 12,
            }}
        >
            {/* Input section */}
            <div>
                <div
                    className="text-[11px] font-semibold uppercase"
                    style={{
                        letterSpacing: "0.08em",
                        color: "var(--dw-muted)",
                        marginBottom: 6,
                    }}
                >
                    Input
                </div>
                <JSONView data={part.input} />
            </div>

            {/* Output section — separated from Input by a 1px top border. */}
            <div
                style={{
                    borderTop: "1px solid var(--dw-border)",
                    paddingTop: 12,
                }}
            >
                <div
                    className="text-[11px] font-semibold uppercase"
                    style={{
                        letterSpacing: "0.08em",
                        color: "var(--dw-muted)",
                        marginBottom: 6,
                    }}
                >
                    Output
                </div>
                {outputContent}
            </div>
        </div>
    );
}

// ---------- ToolPillStrip --------------------------------------------------

export function ToolPillStrip({
    parts,
    expandedToolCallId,
    onToggleExpanded,
    className,
}: ToolPillStripProps) {
    // Empty parts → don't render anything. Saves us from drawing a stray
    // "tools" label with no chips below it.
    // Hook order: we must keep all hook calls before any conditional return
    // for React's rules-of-hooks. So the internal-state hook runs first,
    // then we early-return.
    const [internalExpandedId, setInternalExpandedId] = useState<
        string | null
    >(null);

    if (!parts || parts.length === 0) return null;

    // Controlled vs uncontrolled. The "controlled" mode is active only when
    // BOTH props are supplied — otherwise a parent that passes only the id
    // (without an updater) would silently fail to update on click.
    const isControlled =
        expandedToolCallId !== undefined && onToggleExpanded !== undefined;
    const activeId = isControlled ? expandedToolCallId : internalExpandedId;

    const setExpanded = (next: string | null) => {
        if (isControlled) {
            onToggleExpanded?.(next);
        } else {
            setInternalExpandedId(next);
        }
    };

    const expandedPart =
        activeId != null ? parts.find((p) => p.toolCallId === activeId) : null;

    return (
        <div
            className={className}
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
            }}
        >
            {/* Top row: "tools" label + pill row. The label is intentionally
                lower-case (no transform) per spec — it reads as a quiet
                annotation, not a heading. */}
            <div className="flex items-center gap-2">
                <span
                    className="text-[11px]"
                    style={{ color: "var(--dw-dim)" }}
                >
                    tools
                </span>
                <div
                    className="flex flex-wrap"
                    style={{ gap: 6 }}
                >
                    {parts.map((part) => {
                        const isExpanded = part.toolCallId === activeId;
                        return (
                            <ToolPill
                                key={part.toolCallId}
                                toolName={part.toolName}
                                state={part.state}
                                isExpanded={isExpanded}
                                // Toggle: clicking the active chip collapses;
                                // clicking another chip switches focus.
                                onToggle={() =>
                                    setExpanded(
                                        isExpanded ? null : part.toolCallId,
                                    )
                                }
                            />
                        );
                    })}
                </div>
            </div>

            {/* Shared JSON panel — only rendered when a chip is active.
                Only one panel can be expanded at a time by design; the
                strip's activeId is a single nullable string. */}
            {expandedPart && <ExpandedPanel part={expandedPart} />}
        </div>
    );
}
