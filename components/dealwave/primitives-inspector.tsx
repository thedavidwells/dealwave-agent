"use client";

// components/dealwave/primitives-inspector.tsx
//
// Right-side slide-out drawer that catalogs every Vercel AI primitive
// running in this project, with live activation indicators based on the
// current chat session's messages. Doubles as:
//   1. Interview demo: makes the "which primitives am I using and why"
//      story visual instead of operator-narrated.
//   2. Customer demo / team showcase: same component, same content,
//      different audience.
//   3. Self-rehearsal aid: the cards remind the operator what to
//      talk about as the agent runs.
//
// Activation logic — scans messages[].parts[] for signatures:
//   - AI Gateway / AI SDK / useChat / AI Elements: any message exists
//   - ToolLoopAgent: any tool part
//   - Structured Output: any data-verdict part
//   - Workflow SDK + needsApproval: any tool part with approval state
//   - Sandbox: tool-run_what_if part with output-available
//   - Eval / Next.js rendering: always-on (build-time / framework-level)
//
// Each card expands to show: description, real code snippet from this
// project, and the file path it lives at. Snippets are static strings —
// adding live token/duration metrics is a follow-up (would need stream
// instrumentation).

import { useState } from "react";
import {
    CheckCircle2,
    ChevronDown,
    Code2,
    FileJson,
    Globe,
    Layers,
    MessageSquare,
    Package,
    Pause,
    Wrench,
    X,
    Zap,
} from "lucide-react";
import type { CSSProperties, ComponentType } from "react";
import { cn } from "@/lib/utils";

// Loose message shape — we only inspect part.type and part.state so we
// don't take a hard dep on the AI SDK's UIMessage generic.
type InspectorPart = {
    type: string;
    state?: string;
    approval?: unknown;
};
type InspectorMessage = {
    parts?: InspectorPart[];
};

// Lucide icons accept { size, className, style } — widen the prop type
// from the strict shape exposed by ComponentType<{...}> so we can pass
// inline `style` for color overrides without TS complaining.
type IconComponent = ComponentType<{
    size?: number;
    className?: string;
    style?: CSSProperties;
}>;

// Architectural layers — bottom-of-stack to top. Used to group primitives
// in the sidebar so a viewer can read the architecture at a glance instead
// of inferring it from the order. Each card declares its layer; the render
// groups them under labeled headers.
type PrimitiveLayer =
    | "engine"
    | "runtime"
    | "orchestration"
    | "surface"
    | "platform";

const LAYER_LABEL: Record<PrimitiveLayer, string> = {
    engine: "Engine",
    runtime: "Agent runtime",
    orchestration: "Orchestration",
    surface: "Surface",
    platform: "Platform",
};

// Render order of the layer groups. Mirrors the layered architecture
// diagram so top of the sidebar = bottom of the stack (the engine that
// everything talks to) and bottom of the sidebar = the highest-level
// concerns (framework + quality guardrails).
const LAYER_ORDER: PrimitiveLayer[] = [
    "engine",
    "runtime",
    "orchestration",
    "surface",
    "platform",
];

type PrimitiveDef = {
    id: string;
    icon: IconComponent;
    title: string;
    description: string;
    file: string;
    code: string;
    // Architectural layer for grouping in the sidebar. Optional during
    // migration — primitives without a layer fall to the end ungrouped.
    layer?: PrimitiveLayer;
    // "Has this primitive ever fired in the current session?" — the
    // green-dot predicate. Stays green for the rest of the session once true.
    activate: (msgs: InspectorMessage[]) => boolean;
    // Optional "is this primitive in flight RIGHT NOW?" predicate. When
    // true, the card gets a card-glow animation indicating active execution
    // — distinguishes "ran 30s ago" from "running this very second." Omitted
    // for always-on primitives (Next.js Rendering, Eval) where the
    // distinction is meaningless.
    activateLive?: (msgs: InspectorMessage[]) => boolean;
};

// ─── Activation predicates ──────────────────────────────────────────────

const hasAnyMessage = (msgs: InspectorMessage[]) => msgs.length > 0;

const hasAnyToolPart = (msgs: InspectorMessage[]) =>
    msgs.some((m) =>
        m.parts?.some((p) => p.type?.startsWith("tool-")),
    );

const hasDataPart = (msgs: InspectorMessage[], typeName: string) =>
    msgs.some((m) => m.parts?.some((p) => p.type === typeName));

const hasApprovalPart = (msgs: InspectorMessage[]) =>
    msgs.some((m) =>
        m.parts?.some(
            (p) =>
                p.type?.startsWith("tool-") &&
                p.approval !== undefined,
        ),
    );

const hasToolWithOutput = (msgs: InspectorMessage[], toolType: string) =>
    msgs.some((m) =>
        m.parts?.some(
            (p) => p.type === toolType && p.state === "output-available",
        ),
    );

// ─── In-flight predicates (for activateLive) ───────────────────────────
//
// A tool part is "in flight" when its state is input-streaming (model is
// emitting args) or input-available (args ready, execute() running). These
// predicates power the active-NOW glow on a primitive card — distinct
// from the static green dot which only tells you "ever fired this session."

const hasInFlightToolPart = (msgs: InspectorMessage[]) =>
    msgs.some((m) =>
        m.parts?.some(
            (p) =>
                p.type?.startsWith("tool-") &&
                (p.state === "input-streaming" || p.state === "input-available"),
        ),
    );

const hasInFlightTool = (msgs: InspectorMessage[], toolType: string) =>
    msgs.some((m) =>
        m.parts?.some(
            (p) =>
                p.type === toolType &&
                (p.state === "input-streaming" || p.state === "input-available"),
        ),
    );

const hasPendingApproval = (msgs: InspectorMessage[]) =>
    msgs.some((m) =>
        m.parts?.some(
            (p) =>
                p.type?.startsWith("tool-") &&
                p.state === "approval-requested",
        ),
    );

// Advisor pending: research returned successfully but the structured
// Verdict hasn't materialized yet. Indicates the advisor generateObject
// call is currently running.
const isAdvisorPending = (msgs: InspectorMessage[]) => {
    const hasResearchOutput = msgs.some((m) =>
        m.parts?.some(
            (p) =>
                (p.type === "tool-analyze_deal" ||
                    p.type === "tool-pull_comps") &&
                p.state === "output-available",
        ),
    );
    const hasVerdict = msgs.some((m) =>
        m.parts?.some((p) => p.type === "data-verdict"),
    );
    return hasResearchOutput && !hasVerdict;
};

// ─── The 10 primitives ─────────────────────────────────────────────────
//
// Order is INTENTIONAL — layered bottom-of-stack to top-of-stack so the
// sidebar reads as an architecture diagram, not a chronological event log:
//
//   1.  AI Gateway        — the engine; every model call routes through it
//   2.  AI SDK            — TypeScript lib that talks to the Gateway
//   3.  ToolLoopAgent     — the loop pattern inside the SDK
//   4.  Sandbox           — a tool the loop can call; isolated Python runtime
//   5.  Structured Output — typed Verdict emitted at the end of the loop
//   6.  Workflow + needsApproval — durable orchestration wrapping the runtime
//   7.  useChat           — client-side streaming harness
//   8.  AI Elements       — shadcn-style components on top of useChat
//   9.  Next.js Rendering — page-level framework primitive (ISR)
//   10. Eval              — CI guardrail outside the request runtime
//
// Read top-to-bottom and you can narrate the request path. That's the point.

const PRIMITIVES: PrimitiveDef[] = [
    {
        id: "ai-gateway",
        icon: Globe,
        title: "AI Gateway",
        description:
            "Routes every model call through ai-gateway.vercel.sh via plain-string model IDs. Enables hot-swap of provider/model and a per-request provider fallback order.",
        file: "app/api/chat/route.ts",
        code: `model: "anthropic/claude-haiku-4-5",
providerOptions: {
  gateway: { order: ["anthropic", "bedrock"] }
}`,
        layer: "engine",
        activate: hasAnyMessage,
    },
    {
        id: "ai-sdk",
        icon: Package,
        title: "AI SDK (ai)",
        description:
            "TypeScript SDK abstracting every model provider. streamText for the tool loop, generateObject for structured output, tool() for tool definitions, convertToModelMessages for UI ↔ wire conversion.",
        file: "app/api/chat/route.ts, lib/tools/*",
        code: `import {
  streamText,
  generateObject,
  convertToModelMessages,
  stepCountIs,
} from "ai";`,
        layer: "engine",
        activate: hasAnyMessage,
    },
    {
        id: "tool-loop",
        icon: Wrench,
        title: "ToolLoopAgent Pattern",
        description:
            "Multi-step tool calling. Model decides → tool runs (Zod-validated) → result appended → loop until done or stopWhen fires. Five tools registered: analyze_deal, pull_comps, create_deal, list_deals, run_what_if.",
        file: "app/api/chat/route.ts",
        code: `streamText({
  model: researchModel,
  tools: { analyze_deal, pull_comps, create_deal,
           list_deals, run_what_if },
  stopWhen: stepCountIs(10),
})`,
        layer: "runtime",
        activate: hasAnyToolPart,
        activateLive: hasInFlightToolPart,
    },
    {
        id: "sandbox",
        icon: Code2,
        title: "Sandbox",
        description:
            "Isolated python3.13 runtime for compute that doesn't fit in Edge. run_what_if spawns a sandbox, installs numpy + matplotlib, runs 10k Monte Carlo trials, and returns P10/P50/P90 + histogram PNG.",
        file: "lib/tools/run-what-if.ts",
        code: `const sandbox = await Sandbox.create({
  runtime: "python3.13",
  timeout: 90_000,
});
await sandbox.runCommand({
  cmd: "pip", args: ["install", "numpy", "matplotlib"],
});`,
        layer: "runtime",
        activate: (msgs) => hasToolWithOutput(msgs, "tool-run_what_if"),
        activateLive: (msgs) => hasInFlightTool(msgs, "tool-run_what_if"),
    },
    {
        id: "structured-output",
        icon: FileJson,
        title: "Structured Output",
        description:
            "After the tool loop, the advisor model emits a typed Verdict via generateObject + Zod schema. Drives the verdict banner, metric tiles, narrative, risks, and follow-up chips you see in the chat.",
        file: "lib/schemas/verdict.ts",
        code: `const { object: verdict } = await generateObject({
  model: advisorModel,
  schema: VerdictSchema,
  prompt: \`Produce a Verdict from: \${results}\`,
});`,
        layer: "runtime",
        activate: (msgs) => hasDataPart(msgs, "data-verdict"),
        activateLive: isAdvisorPending,
    },
    {
        id: "workflow-sdk",
        icon: Pause,
        title: "Workflow SDK + needsApproval",
        description:
            "Human-in-the-loop with durable pause. 'use workflow' directive makes execution state survive serverless restarts. needsApproval: true on create_deal triggers a typed pause that resumes via /api/agent/approve.",
        file: "lib/workflows/deal-analyst.ts",
        code: `'use workflow';

const reviewHook = defineHook<{
  decision: "approved" | "skipped",
  notes?: string,
}>();

await reviewHook.create({ token: dealId });`,
        layer: "orchestration",
        activate: hasApprovalPart,
        activateLive: hasPendingApproval,
    },
    {
        id: "use-chat",
        icon: MessageSquare,
        title: "Streaming UI / useChat",
        description:
            "Bidirectional chat with token streaming + typed message parts (text, tool-<name>, custom data-verdict). Tool calls render as collapsible cards / inline chips. Verdict renders as a custom data part.",
        file: "app/page.tsx",
        code: `const {
  messages, sendMessage, status,
  addToolApprovalResponse, setMessages,
} = useChat({
  transport: new DefaultChatTransport({ api: "/api/chat" }),
  sendAutomaticallyWhen: ...,
});`,
        layer: "surface",
        activate: hasAnyMessage,
    },
    {
        id: "ai-elements",
        icon: Layers,
        title: "AI Elements",
        description:
            "Vercel's official AI SDK component library installed shadcn-style. Conversation, Message, MessageResponse, Tool family, PromptInput family, Shimmer, Suggestion. We own the code; customize freely.",
        file: "components/ai-elements/*",
        code: `import {
  Conversation, ConversationContent,
} from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";`,
        layer: "surface",
        activate: hasAnyMessage,
    },
    {
        id: "nextjs-rendering",
        icon: Zap,
        title: "Next.js Rendering",
        description:
            "ISR page at /deals/[id] with revalidate=60. Saved deals get a cacheable, refreshable detail page that fetches from DealWave's API and renders server-side.",
        file: "app/deals/[id]/page.tsx",
        code: `export const revalidate = 60;

export default async function DealPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await fetchDeal(id);
  return <DealDetail deal={deal} />;
}`,
        layer: "platform",
        activate: () => true,
    },
    {
        id: "eval",
        icon: CheckCircle2,
        title: "Eval (CI-Gate Pattern)",
        description:
            "Regression test set with gold expected tools + recommendations. Asserts (1) right tools called in right order, (2) recommendation matches gold. Passes today, would block deploy on regression.",
        file: "evals/run.ts, evals/test-cases.json",
        code: `for (const c of cases) {
  const result = await runAgent(c.prompt);
  assert.ok(
    c.expectedTools.every(t => result.tools.includes(t))
  );
  assert.equal(
    result.verdict.recommendation, c.expected
  );
}`,
        layer: "platform",
        activate: () => true,
    },
];

// ─── Component ─────────────────────────────────────────────────────────

export type PrimitivesInspectorProps = {
    open: boolean;
    onClose: () => void;
    messages: InspectorMessage[];
};

export function PrimitivesInspector({
    open,
    onClose,
    messages,
}: PrimitivesInspectorProps) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    // Compute activation up-front so the X/10 counter and the dot color
    // can read from the same source of truth. activeLive is the "in flight
    // RIGHT NOW" signal — drives the card-glow animation that highlights
    // exactly which primitive is currently working.
    const states = PRIMITIVES.map((p) => ({
        ...p,
        active: p.activate(messages),
        activeLive: p.activateLive?.(messages) ?? false,
    }));
    const activeCount = states.filter((s) => s.active).length;

    const toggle = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <aside
            aria-label="Vercel AI Primitives in use"
            aria-hidden={!open}
            className={cn(
                "fixed right-0 bottom-0 z-40 flex flex-col transition-transform duration-300 ease-out",
                open ? "translate-x-0" : "translate-x-full",
            )}
            style={{
                // Sit BELOW the page header (which is ~49px tall with its
                // bottom border). Avoids the inspector's own header colliding
                // with the DW logo / AI Primitives toggle in the page header.
                top: 49,
                width: 400,
                background: "var(--dw-surface)",
                // No left border, no box-shadow. The contrast between
                // var(--dw-surface) and var(--dw-bg) is enough to define
                // the drawer edge. A 1px border felt like UI clutter against
                // the chat pane next to it; removed for a cleaner read.
            }}
        >
            {/* ─── Header ────────────────────────────────────────────── */}
            <header
                className="flex items-center justify-between"
                style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--dw-border)",
                }}
            >
                <div className="flex items-center" style={{ gap: 8 }}>
                    <Zap size={16} className="text-amber-400" />
                    <h2
                        className="text-sm font-medium"
                        style={{ color: "var(--dw-text)" }}
                    >
                        AI Primitives in Use
                    </h2>
                </div>
                <div className="flex items-center" style={{ gap: 8 }}>
                    <span
                        className="text-xs font-mono tabular-nums"
                        style={{ color: "var(--dw-sub)" }}
                    >
                        {activeCount} / {PRIMITIVES.length}
                    </span>
                    <button
                        onClick={onClose}
                        aria-label="Close inspector"
                        className="p-1 rounded transition-colors"
                        style={{ color: "var(--dw-sub)" }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--dw-text)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--dw-sub)";
                        }}
                    >
                        <X size={14} />
                    </button>
                </div>
            </header>

            <p
                className="text-xs"
                style={{
                    padding: "10px 16px 12px",
                    color: "var(--dw-dim)",
                }}
            >
                Live inspection of the current session
            </p>

            {/* ─── Scrollable card stack ───────────────────────────────── */}
            <div
                className="flex-1 overflow-y-auto"
                style={{ padding: "0 12px 16px", gap: 8 }}
            >
                <div className="flex flex-col" style={{ gap: 8 }}>
                    {LAYER_ORDER.map((layer, groupIndex) => {
                        const cardsInLayer = states.filter(
                            (s) => s.layer === layer,
                        );
                        if (cardsInLayer.length === 0) return null;
                        return (
                            <div
                                key={layer}
                                className="flex flex-col"
                                style={{ gap: 8 }}
                            >
                                {/* Layer header — small, tight, semibold so it
                                    reads as an architectural label, not a heading.
                                    Top margin only on non-first groups creates
                                    visual breathing room between layers. */}
                                <div
                                    className="text-[10px] font-semibold uppercase"
                                    style={{
                                        letterSpacing: "0.12em",
                                        color: "var(--dw-dim)",
                                        marginTop: groupIndex === 0 ? 0 : 14,
                                        marginBottom: 2,
                                        paddingLeft: 4,
                                    }}
                                >
                                    {LAYER_LABEL[layer]}
                                </div>
                                {cardsInLayer.map((p) => {
                        const Icon = p.icon;
                        const isOpen = expanded.has(p.id);
                        // When a primitive is in flight RIGHT NOW (not just
                        // ever-fired), the card gets the animate-card-glow
                        // class so the eye lands on exactly what's running
                        // this very second.
                        return (
                            <div
                                key={p.id}
                                className={cn(
                                    "rounded-md overflow-hidden",
                                    p.activeLive && "animate-card-glow",
                                )}
                                style={{
                                    background: "var(--dw-surface-1)",
                                    border: "1px solid var(--dw-border)",
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={() => toggle(p.id)}
                                    className="w-full flex items-center text-left"
                                    style={{
                                        padding: "10px 12px",
                                        gap: 10,
                                    }}
                                    aria-expanded={isOpen}
                                >
                                    {/* Activation dot — green when primitive has
                                        ever fired this session; pulse animation
                                        runs only when active so gray dots stay
                                        still. */}
                                    <span
                                        aria-label={
                                            p.active
                                                ? "active"
                                                : "not yet activated"
                                        }
                                        className={cn(
                                            "rounded-full flex-shrink-0 transition-colors",
                                            p.active
                                                ? "bg-emerald-400 animate-dot-pulse"
                                                : "bg-zinc-700",
                                        )}
                                        style={{ width: 6, height: 6 }}
                                    />

                                    <Icon
                                        size={14}
                                        className="flex-shrink-0"
                                        style={{
                                            color: p.active
                                                ? "var(--dw-text)"
                                                : "var(--dw-sub)",
                                        }}
                                    />

                                    <span
                                        className="flex-1 text-sm font-mono"
                                        style={{
                                            color: p.active
                                                ? "var(--dw-text)"
                                                : "var(--dw-sub)",
                                        }}
                                    >
                                        {p.title}
                                    </span>

                                    <ChevronDown
                                        size={14}
                                        className={cn(
                                            "transition-transform flex-shrink-0",
                                            isOpen && "rotate-180",
                                        )}
                                        style={{ color: "var(--dw-dim)" }}
                                    />
                                </button>

                                {isOpen && (
                                    <div
                                        className="flex flex-col"
                                        style={{
                                            padding: "0 12px 12px",
                                            gap: 8,
                                            borderTop:
                                                "1px solid var(--dw-border)",
                                        }}
                                    >
                                        <p
                                            className="text-xs"
                                            style={{
                                                paddingTop: 10,
                                                color: "var(--dw-sub)",
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            {p.description}
                                        </p>

                                        <pre
                                            className="text-[11px] font-mono overflow-x-auto rounded"
                                            style={{
                                                padding: 10,
                                                background:
                                                    "rgba(0,0,0,0.35)",
                                                border: "1px solid var(--dw-border)",
                                                color: "var(--dw-text)",
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            <code>{p.code}</code>
                                        </pre>

                                        <p
                                            className="text-xs font-mono"
                                            style={{
                                                color: "var(--dw-dim)",
                                            }}
                                        >
                                            {p.file}
                                        </p>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                            </div>
                        );
                    })}
                </div>

                {/* Footer caption */}
                <p
                    className="text-xs text-center"
                    style={{
                        marginTop: 16,
                        color: "var(--dw-dim)",
                    }}
                >
                    Activation dots fill as each primitive runs.
                </p>
            </div>
        </aside>
    );
}
