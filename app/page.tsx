"use client";
// The 'use client' directive tells Next.js that this page is a client component.
// Client components are components that are rendered on the client side.
// This means that the component will be rendered on the client side and not on the server side.
// This is useful for components that need to interact with the browser API.

// The 'use client is requred because useChat manages state, usees fetch streaming, and renders interactively.
// Without it, this is a server component and the hook will crash at build time.

import { useChat } from "@ai-sdk/react";
import {
    isToolUIPart,
    getToolName,
    lastAssistantMessageIsCompleteWithToolCalls,
    lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";

// AI Elements — Vercel's official component library for AI SDK apps.
// Installed shadcn-style (components live in /components/ai-elements/),
// so we OWN the code and can customize. Designed specifically to consume
// useChat's typed message parts (text, tool-<name>, reasoning, etc.).
import {
    Conversation,
    ConversationContent,
    ConversationEmptyState,
    ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
    Message,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";
import {
    Tool,
    ToolContent,
    ToolHeader,
    ToolInput,
    ToolOutput,
} from "@/components/ai-elements/tool";
import {
    PromptInput,
    PromptInputBody,
    PromptInputTextarea,
    PromptInputFooter,
    PromptInputSubmit,
    PromptInputTools,
    type PromptInputMessage,
    type PromptInputProps,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
// VerdictCard renders the typed Verdict object emitted by the Sonnet
// synthesis step (custom data-verdict part on the message stream).
// This is the Concept 01 visual centerpiece: banner + metric tiles +
// risk warnings + follow-up suggestion chips.
import { VerdictCard, type Verdict } from "@/components/dealwave/verdict-card";

export default function Home() {
    // useChat manages the full conversation state.
    // Internally it:
    //    1. Holds the messages array in React state.
    //    2. POSTs to /api/chat with { messages } whenever sendMessage() is called
    //    3. Streams the response back to the client via SSE.
    //    4. Parses the UI message stream events and appends them to messages
    //    5. Re-renders this component on every update.
    const { messages, sendMessage, status, addToolApprovalResponse } = useChat({
        // Fire the resume request when EITHER:
        //   - all client-side tool calls have outputs (future: when we add tools
        //     that run client-side and need to send results back), OR
        //   - all pending approvals have been answered (our create_deal case).
        // Approvals and outputs are tracked separately by the SDK, so we OR
        // the two predicates to cover both paths.
        sendAutomaticallyWhen: ({ messages }) =>
            lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
            lastAssistantMessageIsCompleteWithApprovalResponses({ messages }),
    });

    // PromptInput manages its own textarea state internally, so we no longer
    // need a form ref or DOM query like we did with the raw <input>. It hands
    // us the parsed message + the raw event on submit.
    // PromptInputMessage = { text: string; files: FileUIPart[] }
    const handleSubmit: PromptInputProps["onSubmit"] = (message, e) => {
        e.preventDefault();
        if (!message.text.trim()) return;

        // sendMessage triggers the POST to /api/chat with the new user message
        // appended to the existing message history.
        sendMessage({ text: message.text });
    };

    return (
        <div className="flex h-screen flex-col bg-background">
            {/* Header — DealWave brand + one-line value prop.
                Static shell; renders as part of the server component output
                before useChat hydrates the client tree. */}
            <header className="border-b px-6 py-4">
                <div className="mx-auto max-w-3xl">
                    <h1 className="text-xl font-semibold tracking-tight">
                        DealWave Deal Analyst
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Underwrite a property in seconds — AI Gateway + DealWave
                    </p>
                </div>
            </header>

            {/* Conversation history.
                messages[].parts is an array of typed parts: { type: 'text', text }, etc.
                The <Conversation> component handles scroll behavior, sticky-to-bottom
                during stream, and shows a scroll-to-bottom button if the user scrolls up.
                We render each part type with the appropriate AI Elements component. */}
            <Conversation className="flex-1">
                <ConversationContent className="mx-auto max-w-3xl">
                    {messages.length === 0 && (
                        <ConversationEmptyState
                            title="Ready to analyze a deal"
                            description="Paste a property address and I'll pull underwriting data, validate with comps, and give you a buy/pass recommendation."
                        />
                    )}

                    {messages.map((m, mi) => {
                        // Detect "synthesis pending" state for THIS message.
                        // After Haiku finishes streaming text + tool results,
                        // Sonnet runs the verdict synthesis (3-5s). During that
                        // window the message has analysis tool results but no
                        // data-verdict part yet. We show a Shimmer in that gap
                        // so the wait feels intentional, not broken.
                        const isLast = mi === messages.length - 1;
                        const hasAnalysisResult =
                            m.parts?.some(
                                (p) =>
                                    isToolUIPart(p) &&
                                    p.state === "output-available" &&
                                    (getToolName(p) === "analyze_deal" ||
                                        getToolName(p) === "pull_comps"),
                            ) ?? false;
                        const hasVerdict =
                            m.parts?.some((p) => p.type === "data-verdict") ??
                            false;
                        const showSynthesizing =
                            isLast &&
                            m.role === "assistant" &&
                            status === "streaming" &&
                            hasAnalysisResult &&
                            !hasVerdict;

                        return (
                            <Message key={m.id} from={m.role}>
                                <MessageContent>
                                    {m.parts?.map((part, i) => {
                                        // Plain text from the model.
                                        // <Response> is a streaming-aware markdown renderer:
                                        // headers, lists, code fences, and inline formatting all
                                        // render correctly even while tokens are still arriving
                                        // (no broken layouts mid-stream).
                                        if (part.type === "text") {
                                            return (
                                                <MessageResponse key={i}>
                                                    {part.text}
                                                </MessageResponse>
                                            );
                                        }

                                        // Tool call in progress — the model decided to call a tool.
                                        // The exact type name depends on the tool. v5 emits 'tool-<toolname>'
                                        // for each registered tool, with sub-states for input/output:
                                        //   'input-streaming' | 'input-available' | 'output-available' | 'output-error'
                                        // The <Tool> family renders this as a collapsible card with
                                        // a status indicator (spinner / check / error icon), the input
                                        // JSON, and the output JSON. Auto-opens on error so the user
                                        // sees what went wrong without clicking to expand.
                                        if (isToolUIPart(part)) {
                                            return (
                                                <Tool
                                                    key={i}
                                                    defaultOpen={
                                                        part.state ===
                                                        "output-error"
                                                    }
                                                >
                                                    {/* ToolHeader props are a discriminated union:
                - static tools (type = `tool-${name}`) encode the name in the type
                - dynamic tools (type = "dynamic-tool") require a separate toolName field.
                We branch so TS narrows correctly. Our project only uses static tools
                today, but handling both makes the code future-proof and satisfies the
                type system without an unsafe `as` cast. */}
                                                    {part.type ===
                                                    "dynamic-tool" ? (
                                                        <ToolHeader
                                                            type={part.type}
                                                            state={part.state}
                                                            toolName={
                                                                part.toolName
                                                            }
                                                        />
                                                    ) : (
                                                        <ToolHeader
                                                            type={part.type}
                                                            state={part.state}
                                                        />
                                                    )}

                                                    <ToolContent>
                                                        <ToolInput
                                                            input={part.input}
                                                        />
                                                        <ToolOutput
                                                            output={part.output}
                                                            errorText={
                                                                part.state ===
                                                                "output-error"
                                                                    ? part.errorText
                                                                    : undefined
                                                            }
                                                        />
                                                    </ToolContent>
                                                    {/* Approval gate — when a tool has needsApproval:true, the loop pauses
                                                    at approval-requested state. The user must respond before execute fires.
                                                    This is the human-in-the-loop demo moment. We replace this minimal
                                                    button row with the polished Action Required block Sunday. */}
                                                    {part.state ===
                                                        "approval-requested" && (
                                                        <div className="flex gap-2 border-t border-border/50 p-3">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    addToolApprovalResponse(
                                                                        {
                                                                            id: part
                                                                                .approval
                                                                                .id, // ← was part.toolCallId
                                                                            approved: true,
                                                                        },
                                                                    )
                                                                }
                                                                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
                                                            >
                                                                Save Deal
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    addToolApprovalResponse(
                                                                        {
                                                                            id: part
                                                                                .approval
                                                                                .id, // ← was part.toolCallId
                                                                            approved: false,
                                                                        },
                                                                    )
                                                                }
                                                                className="rounded-md border px-4 py-1.5 text-sm"
                                                            >
                                                                Skip
                                                            </button>
                                                        </div>
                                                    )}
                                                </Tool>
                                            );
                                        }

                                        // Custom data-verdict part — emitted by the
                                        // Sonnet synthesis step after the tool loop
                                        // completes. Renders as the Concept 01 verdict
                                        // banner + metric tile strip + risk warnings +
                                        // follow-up chips.
                                        if (part.type === "data-verdict") {
                                            // `data` is typed `unknown` at the UIMessage
                                            // union level; we trust the server's
                                            // generateObject to have validated against
                                            // VerdictSchema before emitting.
                                            const verdict = (
                                                part as { data: Verdict }
                                            ).data;
                                            return (
                                                <VerdictCard
                                                    key={i}
                                                    verdict={verdict}
                                                    // Clicking a follow-up chip fires a
                                                    // new user turn — the chip becomes a
                                                    // real conversation message.
                                                    onFollowUp={(prompt) =>
                                                        sendMessage({
                                                            text: prompt,
                                                        })
                                                    }
                                                />
                                            );
                                        }

                                        // Any part type we haven't explicitly handled
                                        // (reasoning, source, file, data-*, etc.) — skip silently.
                                        // Add specific renderers here as we need them.
                                        return null;
                                    })}

                                    {/* Synthesis-pending Shimmer — bridges the 3-5s
                                        wait between Haiku finishing its text response
                                        and Sonnet emitting the typed verdict. Without
                                        this the input feels frozen; with it the wait
                                        feels intentional. Disappears the moment the
                                        verdict arrives and VerdictCard renders above. */}
                                    {showSynthesizing && (
                                        <div className="my-3">
                                            <Shimmer>
                                                Generating detailed verdict…
                                            </Shimmer>
                                        </div>
                                    )}
                                </MessageContent>
                            </Message>
                        );
                    })}

                    {/* Status indicator — shows when the model is thinking/streaming.
                        status: 'ready' | 'submitted' | 'streaming' | 'error'.
                        We show <Loader/> only during 'submitted' — the gap between
                        the user hitting Send and the first token arriving. Once tokens
                        start flowing the loader unmounts and <Response> takes over. */}
                    {status === "submitted" && (
                        <div className="px-4 py-2">
                            <Shimmer>Thinking…</Shimmer>
                        </div>
                    )}
                </ConversationContent>

                {/* Floating "scroll to bottom" button — appears only when the user
                    has scrolled up from the bottom of the conversation. */}
                <ConversationScrollButton />
            </Conversation>

            {/* Prompt input — pinned to bottom. PromptInput handles:
                - Auto-resizing textarea (grows up to ~8 lines, sized to content)
                - Submit on Enter, newline on Shift+Enter
                - Accessibility (proper labels + keyboard nav)
                - Status-aware submit button (spinner during stream) */}
            <div className="border-t bg-background">
                <div className="mx-auto w-full max-w-3xl px-4 py-3">
                    <PromptInput onSubmit={handleSubmit}>
                        <PromptInputTextarea
                            // w-full forces the textarea to fill the InputGroup,
                            // counteracting field-sizing-content which would otherwise
                            // shrink to the empty content width on first render.
                            className="w-full"
                            placeholder="Try: Analyze 10165 W Burntwood Ct, Boise, ID"
                            disabled={
                                status === "streaming" || status === "submitted"
                            }
                        />
                        {/* Footer holds action buttons on the left + submit on the right.
                            Default classes (justify-between gap-1) handle the layout —
                            no need to override. PromptInputTools is the canonical
                            container for left-side action buttons; we leave it empty
                            for now and add a model picker, attachment button etc. later. */}
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
                </div>
            </div>
        </div>
    );
}
