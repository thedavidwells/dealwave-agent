"use client";

// app/page.tsx — DealWave Agent chat surface.
//
// Top-level structure:
//   - Header (DW logo + wordmark + AI Gateway pill + EvalBadge + New analysis)
//   - Body:
//       · Empty state (hero + animated dot grid + suggestion chips + gateway bar)
//       · OR Chat conversation (messages with tool pill strips, verdict cards,
//         approval prompts, and shimmer placeholders)
//   - Footer prompt input + model selector strip
//
// 'use client' is required because useChat manages state, uses fetch
// streaming, and renders interactively. Without it, this is a server
// component and the hook would crash at build time.

import { useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
    isToolUIPart,
    getToolName,
    lastAssistantMessageIsCompleteWithToolCalls,
    lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { PlusIcon, Zap } from "lucide-react";

// AI Elements — we keep PromptInput (handles the textarea/submit ergonomics
// nicely) and Conversation (sticky-to-bottom scroll behavior). The Tool family
// is replaced by our own ToolPillStrip; the Shimmer + Suggestion components
// are replaced by design-handoff equivalents.
import {
    Conversation,
    ConversationContent,
    ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
    Message,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";
import {
    PromptInput,
    PromptInputTextarea,
    PromptInputFooter,
    PromptInputSubmit,
    PromptInputTools,
    type PromptInputProps,
} from "@/components/ai-elements/prompt-input";

// DealWave-owned chrome — built to match the design handoff.
import { VerdictCard, type Verdict } from "@/components/dealwave/verdict-card";
import {
    ModelSelectorBar,
    useModelSelection,
    type AdvisorModel,
    type BackupProvider,
    type ResearchModel,
} from "@/components/dealwave/model-selector";
import { DWLogo } from "@/components/dealwave/dw-logo";
import { IntelligentWaveField } from "@/components/dealwave/intelligent-wave-field";
import GatewayBar from "@/components/dealwave/gateway-bar";
import { ToolPillStrip } from "@/components/dealwave/tool-pill";
import { ApprovalPrompt } from "@/components/dealwave/approval-prompt";
import { ShimmerBlock } from "@/components/dealwave/shimmer-block";
import {
    WhatIfHistogram,
    isRunWhatIfOutput,
} from "@/components/dealwave/what-if-histogram";
import { PrimitivesInspector } from "@/components/dealwave/primitives-inspector";

// Suggestion chips shown in the empty state. SFR-investor friendly —
// intentionally not the commercial multi-family examples from the design
// handoff (DealWave is single-family residential).
const SUGGESTIONS = [
    "Analyze 1532 W Chateau Ave, Meridian, ID",
    "Show me my recent deals",
    "What metrics matter most for a fix-and-flip?",
];

export default function Home() {
    // useChat manages the full conversation state and SSE stream lifecycle.
    // setMessages is exposed so the "+ New analysis" header button can reset
    // the conversation in-place without a full page reload.
    const { messages, sendMessage, setMessages, status, addToolApprovalResponse } =
        useChat({
            // Fire the resume request when EITHER:
            //   - all client-side tool calls have outputs (future-proofing
            //     for client-side tools we may add), OR
            //   - all pending approvals have been answered (our create_deal
            //     case — needsApproval pauses the loop until the user clicks
            //     Save or Skip in ApprovalPrompt).
            // Approvals and outputs are tracked separately by the SDK, so we
            // OR the two predicates to cover both resume paths.
            sendAutomaticallyWhen: ({ messages }) =>
                lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
                lastAssistantMessageIsCompleteWithApprovalResponses({
                    messages,
                }),
        });

    // Model selection (research / advisor / backup). Persisted in
    // localStorage so a page reload preserves the user's choice. The
    // selection is forwarded with every send so the server route can
    // override its hardcoded defaults on a per-request basis. Server
    // re-validates against an allowlist — anything stale or tampered
    // falls back to defaults silently.
    const { models, update: updateModels } = useModelSelection();

    // One expanded ToolPill at a time across the whole conversation.
    // Keyed by toolCallId so the highlight survives re-renders and so a
    // user can compare two tool calls by toggling between them. null =
    // nothing expanded.
    const [expandedToolCallId, setExpandedToolCallId] = useState<string | null>(
        null,
    );

    // PrimitivesInspector visibility — right-side drawer cataloging every
    // Vercel AI primitive in use, with live activation indicators. Persisted
    // in localStorage so the user's preference survives reloads, defaults
    // closed on first visit. Hydrated from localStorage post-mount to avoid
    // SSR/CSR mismatch.
    const [inspectorOpen, setInspectorOpen] = useState(false);
    useEffect(() => {
        const stored = window.localStorage.getItem("dw:inspector-open");
        if (stored === "1") setInspectorOpen(true);
    }, []);
    useEffect(() => {
        window.localStorage.setItem(
            "dw:inspector-open",
            inspectorOpen ? "1" : "0",
        );
    }, [inspectorOpen]);

    // PromptInput hands us a parsed message + the raw event on submit.
    // PromptInputMessage = { text: string; files: FileUIPart[] }
    const handleSubmit: PromptInputProps["onSubmit"] = (message, e) => {
        e.preventDefault();
        if (!message.text.trim()) return;
        sendMessage({ text: message.text }, { body: { models } });
    };

    const isEmpty = messages.length === 0;

    return (
        <div
            className="flex h-screen flex-col"
            style={{ background: "var(--dw-bg)" }}
        >
            {/* ── Header ─────────────────────────────────────────────────
                11px 24px padding, 1px bottom border per the design spec.
                Left: DW logo + wordmark. Right: AI Gateway pill + EvalBadge
                + New analysis button. Z-index 10 so it sits above the
                animated dot grid in the empty state. */}
            <header
                className="relative z-10 flex items-center justify-between"
                style={{
                    padding: "11px 24px",
                    borderBottom: "1px solid var(--dw-border)",
                }}
            >
                <div className="flex items-center" style={{ gap: 12 }}>
                    <DWLogo />
                    <span
                        style={{
                            fontSize: 15,
                            fontWeight: 500,
                            color: "rgba(255,255,255,0.82)",
                        }}
                    >
                        DealWave Agent
                    </span>
                </div>

                <div className="flex items-center" style={{ gap: 8 }}>
                    {/* AI Primitives toggle — replaces the old static AI
                        Gateway pill + EvalBadge. Opens the right-side
                        PrimitivesInspector drawer which shows every Vercel
                        primitive in use plus live activation indicators.
                        That drawer is the demo's "explain my architecture"
                        surface — Ale (and future viewers) can see what
                        primitive is firing as the agent runs. */}
                    <button
                        type="button"
                        onClick={() => setInspectorOpen((v) => !v)}
                        aria-pressed={inspectorOpen}
                        aria-label="Toggle AI Primitives inspector"
                        className="flex items-center transition-colors"
                        style={{
                            gap: 6,
                            padding: "5px 11px",
                            background: inspectorOpen
                                ? "var(--dw-surface-1)"
                                : "transparent",
                            border: "1px solid var(--dw-border)",
                            borderRadius: 4,
                            fontSize: 13,
                            color: inspectorOpen
                                ? "var(--dw-text)"
                                : "var(--dw-sub)",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor =
                                "var(--dw-border-md)";
                            e.currentTarget.style.color = "var(--dw-text)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor =
                                "var(--dw-border)";
                            e.currentTarget.style.color = inspectorOpen
                                ? "var(--dw-text)"
                                : "var(--dw-sub)";
                        }}
                    >
                        <Zap
                            size={13}
                            className="text-amber-400"
                            aria-hidden="true"
                        />
                        AI Primitives
                    </button>

                    {/* "+ New analysis" — visible only mid-conversation.
                        Wipes the in-memory message list via setMessages so
                        the empty state returns. We don't need to reset the
                        model selection (localStorage-persisted intentionally)
                        or the workflow state (durable on the server). */}
                    {!isEmpty && (
                        <button
                            type="button"
                            onClick={() => {
                                setMessages([]);
                                setExpandedToolCallId(null);
                            }}
                            className="flex items-center transition-colors"
                            style={{
                                gap: 5,
                                padding: "5px 11px",
                                background: "transparent",
                                border: "1px solid var(--dw-border)",
                                borderRadius: 4,
                                fontSize: 13,
                                color: "var(--dw-sub)",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor =
                                    "var(--dw-border-md)";
                                e.currentTarget.style.color = "var(--dw-text)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor =
                                    "var(--dw-border)";
                                e.currentTarget.style.color = "var(--dw-sub)";
                            }}
                        >
                            <PlusIcon className="size-3.5" />
                            New analysis
                        </button>
                    )}
                </div>
            </header>

            {/* ── Body ─────────────────────────────────────────────────── */}
            {isEmpty ? (
                <EmptyState
                    onSubmit={(text) =>
                        sendMessage({ text }, { body: { models } })
                    }
                    researchModel={models.research}
                    advisorModel={models.advisor}
                    backupProvider={models.backup}
                    onResearchChange={(research) =>
                        updateModels({ research })
                    }
                    onAdvisorChange={(advisor) => updateModels({ advisor })}
                    onBackupChange={(backup) => updateModels({ backup })}
                />
            ) : (
                <ChatStream
                    messages={messages}
                    status={status}
                    expandedToolCallId={expandedToolCallId}
                    setExpandedToolCallId={setExpandedToolCallId}
                    addToolApprovalResponse={addToolApprovalResponse}
                    onFollowUp={(prompt) =>
                        sendMessage({ text: prompt }, { body: { models } })
                    }
                />
            )}

            {/* ── Prompt input + model selector strip ───────────────────
                Hidden in the empty state — the EmptyState renders its own
                input mock that delegates to the same sendMessage. Once a
                conversation is underway this real PromptInput takes over. */}
            {!isEmpty && (
                <div
                    className="relative z-10"
                    style={{
                        borderTop: "1px solid var(--dw-border)",
                        background: "var(--dw-bg)",
                    }}
                >
                    <div
                        className="mx-auto w-full"
                        style={{ maxWidth: 720, padding: "12px 16px" }}
                    >
                        <PromptInput onSubmit={handleSubmit}>
                            <PromptInputTextarea
                                className="w-full"
                                placeholder="Ask about any deal or property…"
                                disabled={
                                    status === "streaming" ||
                                    status === "submitted"
                                }
                            />
                            <PromptInputFooter>
                                <PromptInputTools />
                                <PromptInputSubmit
                                    status={status}
                                    disabled={
                                        status === "streaming" ||
                                        status === "submitted"
                                    }
                                />
                            </PromptInputFooter>
                        </PromptInput>

                        {/* Interactive model selector — small pills below the
                            input. Persists across the empty/chat transition
                            via localStorage in useModelSelection. */}
                        <div className="mt-2 flex justify-center">
                            <ModelSelectorBar
                                models={models}
                                onChange={updateModels}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* AI Primitives inspector — right-side slide-out drawer.
                Fixed-positioned so it sits above the chat surface; only
                visible when inspectorOpen is true. Receives messages so
                its activation indicators reflect what's actually run in
                the current session. */}
            <PrimitivesInspector
                open={inspectorOpen}
                onClose={() => setInspectorOpen(false)}
                messages={messages}
            />
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// EmptyState — first-screen hero with dot grid + input mock + chips.
// Separated so the chat-active path doesn't pay the cost of mounting
// the dot-grid pseudo-element animations.
// ────────────────────────────────────────────────────────────────────

function EmptyState({
    onSubmit,
    researchModel,
    advisorModel,
    backupProvider,
    onResearchChange,
    onAdvisorChange,
    onBackupChange,
}: {
    onSubmit: (text: string) => void;
    researchModel: ResearchModel;
    advisorModel: AdvisorModel;
    backupProvider: BackupProvider;
    onResearchChange: (model: ResearchModel) => void;
    onAdvisorChange: (model: AdvisorModel) => void;
    onBackupChange: (provider: BackupProvider) => void;
}) {
    const [text, setText] = useState("");

    const submit = (value: string) => {
        const v = value.trim();
        if (!v) return;
        onSubmit(v);
    };

    return (
        <div
            className="relative flex flex-1 flex-col items-center justify-center"
            style={{ padding: "0 60px 100px", gap: 28 }}
        >
            {/* Ambient wave field — vendored from the DealWave marketing
                site. Wrapped at opacity-30 (per the handoff doc's "make
                it subtle" §1) so the brand-color pulses read as quiet
                chrome under the prompt rather than competing for
                attention. The component is `pointer-events-none` so the
                input below stays clickable through it. */}
            <div className="pointer-events-none absolute inset-0 opacity-30">
                <IntelligentWaveField />
            </div>

            {/* Above the dot grid via z-index. The grid is z-0 with
                pointer-events:none, so content sits cleanly on top. */}
            <div
                className="relative z-10 flex flex-col items-center"
                style={{ gap: 28, width: "100%" }}
            >
                <div
                    className="flex flex-col items-center text-center"
                    style={{ gap: 8 }}
                >
                    <h1
                        style={{
                            fontSize: 32,
                            fontWeight: 600,
                            lineHeight: 1.2,
                            letterSpacing: "-0.03em",
                            color: "var(--dw-text)",
                        }}
                    >
                        What deal are you analyzing today?
                    </h1>
                    <p style={{ fontSize: 13, color: "var(--dw-dim)" }}>
                        DealWave API &nbsp;·&nbsp; AI SDK &nbsp;·&nbsp; Vercel
                        AI Gateway
                    </p>
                </div>

                {/* Input mock — uses a real <form> so Enter submits naturally.
                    Maxes at 560px per the design spec. The Send button mirrors
                    the design's white-pill treatment. */}
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        submit(text);
                    }}
                    style={{ width: "100%", maxWidth: 560 }}
                >
                    <div
                        className="flex items-center"
                        style={{
                            padding: "13px 16px",
                            background: "var(--dw-surface-1)",
                            border: "1px solid var(--dw-border-str)",
                            borderRadius: 8,
                            gap: 10,
                            marginBottom: 14,
                        }}
                    >
                        <input
                            type="text"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Ask about any deal or property…"
                            style={{
                                flex: 1,
                                background: "transparent",
                                border: "none",
                                outline: "none",
                                fontSize: 14,
                                color: "var(--dw-text)",
                            }}
                        />
                        <button
                            type="submit"
                            style={{
                                padding: "6px 14px",
                                background: "rgba(255,255,255,0.9)",
                                borderRadius: 5,
                                fontSize: 13,
                                fontWeight: 500,
                                color: "#000",
                                border: "none",
                                cursor: "pointer",
                            }}
                        >
                            Send
                        </button>
                    </div>

                    <div
                        className="flex flex-col"
                        style={{ gap: 6, width: "100%" }}
                    >
                        <span
                            style={{
                                fontSize: 11,
                                color: "var(--dw-dim)",
                                marginBottom: 2,
                            }}
                        >
                            Try:
                        </span>
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => submit(s)}
                                className="block w-full text-left transition-colors"
                                style={{
                                    padding: "11px 15px",
                                    background: "var(--dw-surface-1)",
                                    border: "1px solid var(--dw-border)",
                                    borderRadius: 7,
                                    fontSize: 14,
                                    color: "var(--dw-sub)",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor =
                                        "var(--dw-border-md)";
                                    e.currentTarget.style.background =
                                        "var(--dw-surface-2)";
                                    e.currentTarget.style.color =
                                        "var(--dw-text)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor =
                                        "var(--dw-border)";
                                    e.currentTarget.style.background =
                                        "var(--dw-surface-1)";
                                    e.currentTarget.style.color =
                                        "var(--dw-sub)";
                                }}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </form>

                <GatewayBar
                    researchModel={researchModel}
                    advisorModel={advisorModel}
                    backupProvider={backupProvider}
                    onResearchChange={onResearchChange}
                    onAdvisorChange={onAdvisorChange}
                    onBackupChange={onBackupChange}
                />
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// ChatStream — renders the message list with ToolPillStrip, VerdictCard,
// ApprovalPrompt, and ShimmerBlock placeholders.
// ────────────────────────────────────────────────────────────────────

type ChatMessage = ReturnType<typeof useChat>["messages"][number];
type ToolPart = Extract<
    ChatMessage["parts"][number],
    { type: `tool-${string}` } | { type: "dynamic-tool" }
>;

function ChatStream({
    messages,
    status,
    expandedToolCallId,
    setExpandedToolCallId,
    addToolApprovalResponse,
    onFollowUp,
}: {
    messages: ChatMessage[];
    status: ReturnType<typeof useChat>["status"];
    expandedToolCallId: string | null;
    setExpandedToolCallId: (id: string | null) => void;
    addToolApprovalResponse: ReturnType<
        typeof useChat
    >["addToolApprovalResponse"];
    onFollowUp: (prompt: string) => void;
}) {
    return (
        <Conversation className="flex-1">
            <ConversationContent
                className="mx-auto"
                style={{ maxWidth: 720, padding: "24px 16px" }}
            >
                {messages.map((m, mi) => {
                    // Collect this message's tool parts for the strip.
                    // We render them as ONE strip per message (above the
                    // message body) rather than interleaving each tool
                    // chip wherever it appears in `parts`, which matches
                    // the design's "tools" label preceding the AI reply.
                    const toolParts =
                        m.parts?.filter((p): p is ToolPart => isToolUIPart(p)) ??
                        [];

                    // Map AI SDK tool parts onto the ToolPillStrip's input
                    // shape. `getToolName` strips the 'tool-' prefix.
                    //
                    // The SDK exposes a broader state union than the pill
                    // component knows about — `approval-responded` and
                    // `output-denied` are runtime transitions that don't
                    // need their own visual variants. We collapse them to
                    // the closest existing variant so the pill keeps the
                    // user informed without us shipping new design work:
                    //   - approval-responded → input-available (the tool
                    //     is now allowed to execute and we're waiting on
                    //     output, mirrors the post-input-pre-output state)
                    //   - output-denied → output-error (user declined the
                    //     approval; visually we want a "this didn't run"
                    //     marker, which the error variant provides)
                    const stripParts = toolParts.map((p) => {
                        const state =
                            p.state === "approval-responded"
                                ? ("input-available" as const)
                                : p.state === "output-denied"
                                  ? ("output-error" as const)
                                  : p.state;
                        return {
                            toolCallId: p.toolCallId,
                            toolName: getToolName(p),
                            state,
                            input: p.input,
                            output:
                                p.state === "output-available"
                                    ? p.output
                                    : undefined,
                            errorText:
                                p.state === "output-error"
                                    ? p.errorText
                                    : p.state === "output-denied"
                                      ? "User declined approval"
                                      : undefined,
                        };
                    });

                    // Approval-requested parts get extracted so we can
                    // render an ApprovalPrompt below the strip. There can
                    // only be one approval pending at a time per message
                    // (create_deal is our only needsApproval tool today).
                    const approvalPart = toolParts.find(
                        (p) => p.state === "approval-requested",
                    );

                    // Detect "advisor pending" — research model finished
                    // streaming but the advisor hasn't emitted a verdict
                    // yet. Show ShimmerBlock so the 3-5s wait reads as
                    // intentional. Only relevant for the last message
                    // while we're still streaming.
                    const isLast = mi === messages.length - 1;
                    const hasAnalysisResult = toolParts.some(
                        (p) =>
                            p.state === "output-available" &&
                            (getToolName(p) === "analyze_deal" ||
                                getToolName(p) === "pull_comps"),
                    );
                    const hasVerdict =
                        m.parts?.some((p) => p.type === "data-verdict") ?? false;
                    const showAdvising =
                        isLast &&
                        m.role === "assistant" &&
                        status === "streaming" &&
                        hasAnalysisResult &&
                        !hasVerdict;

                    return (
                        <Message key={m.id} from={m.role}>
                            <MessageContent>
                                {/* Tool pill strip — sits BEFORE the
                                    AI text so the user sees "what is the
                                    agent doing" before reading the result.
                                    Only rendered for assistant messages
                                    with tool calls. */}
                                {m.role === "assistant" &&
                                    stripParts.length > 0 && (
                                        <ToolPillStrip
                                            parts={stripParts}
                                            expandedToolCallId={
                                                expandedToolCallId
                                            }
                                            onToggleExpanded={
                                                setExpandedToolCallId
                                            }
                                        />
                                    )}

                                {m.parts?.map((part, i) => {
                                    // Plain text from the model.
                                    if (part.type === "text") {
                                        return (
                                            <MessageResponse key={i}>
                                                {part.text}
                                            </MessageResponse>
                                        );
                                    }

                                    // run_what_if is the one tool whose
                                    // output deserves a full inline render —
                                    // the histogram is the demo's visual
                                    // moment. Every other tool stays compact
                                    // in the ToolPillStrip above.
                                    if (
                                        isToolUIPart(part) &&
                                        part.type === "tool-run_what_if" &&
                                        "state" in part &&
                                        part.state === "output-available"
                                    ) {
                                        const output = (
                                            part as { output?: unknown }
                                        ).output;
                                        if (isRunWhatIfOutput(output)) {
                                            return (
                                                <WhatIfHistogram
                                                    key={i}
                                                    output={output}
                                                />
                                            );
                                        }
                                        return null;
                                    }

                                    // Other tool parts are rendered as the
                                    // strip above; skip them in the inline pass.
                                    if (isToolUIPart(part)) {
                                        return null;
                                    }

                                    // Custom data-verdict part — emitted
                                    // by the advisor step. Renders as the
                                    // VerdictCard (banner + tile grid +
                                    // risks + narrative + chips).
                                    if (part.type === "data-verdict") {
                                        const verdict = (
                                            part as { data: Verdict }
                                        ).data;
                                        return (
                                            <VerdictCard
                                                key={i}
                                                verdict={verdict}
                                                onFollowUp={onFollowUp}
                                            />
                                        );
                                    }

                                    // Any part type we haven't handled
                                    // (reasoning, source, file, other
                                    // data-* types) — skip silently.
                                    return null;
                                })}

                                {/* ApprovalPrompt — rendered AFTER the
                                    inline message body so it visually
                                    follows the tool strip and any other
                                    parts. The amber accent makes it
                                    impossible to miss. */}
                                {approvalPart &&
                                    approvalPart.state ===
                                        "approval-requested" && (
                                        <ApprovalPrompt
                                            address={
                                                (
                                                    approvalPart.input as {
                                                        address?: string;
                                                    }
                                                )?.address ?? "this deal"
                                            }
                                            onApprove={() =>
                                                addToolApprovalResponse({
                                                    id: approvalPart.approval
                                                        .id,
                                                    approved: true,
                                                })
                                            }
                                            onSkip={() =>
                                                addToolApprovalResponse({
                                                    id: approvalPart.approval
                                                        .id,
                                                    approved: false,
                                                })
                                            }
                                        />
                                    )}

                                {/* Advisor-pending shimmer — bridges the
                                    research-done / verdict-not-yet gap.
                                    Replaces the AI Elements <Shimmer> with
                                    the design's 4-bar block + pulse dot. */}
                                {showAdvising && (
                                    <div className="my-3">
                                        <ShimmerBlock label="building verdict…" />
                                    </div>
                                )}
                            </MessageContent>
                        </Message>
                    );
                })}

                {/* Top-level streaming state — when the user has just
                    submitted but no tokens have arrived yet. ShimmerBlock
                    fills the gap so the input doesn't feel frozen. */}
                {status === "submitted" && (
                    <div className="my-3">
                        <ShimmerBlock label="thinking…" />
                    </div>
                )}
            </ConversationContent>

            <ConversationScrollButton />
        </Conversation>
    );
}
