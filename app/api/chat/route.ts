import {
    streamText,
    generateObject,
    convertToModelMessages,
    stepCountIs,
    createUIMessageStreamResponse,
    createUIMessageStream,
} from "ai";
import { analyzeDealTool } from "@/lib/tools/analyze-deal";
import { pullCompsTool } from "@/lib/tools/pull-comps";
import { createDealTool } from "@/lib/tools/create-deal";
import { VerdictSchema } from "@/lib/schemas/verdict";

// Disable Next.js's default response caching for this route
// AI responses are dynamic per-request - so we don't want to cache them

// (We'll leave the runtime as Node.js default for now.
// Edge runtime would also work for streaming, but Workflow SDK will require node.)

export const dynamic = "force-dynamic";

// Allow up to 60s for the full agent loop + synthesis.
// (Default Next.js function timeout on Hobby/Pro is 10s - we need more because
// analyse_deal alone can take 15-30s seconds on first time properties, and the
// Opus synthesis step adds another ~2-5s after the tool loop completes.)
export const maxDuration = 60;

export async function POST(request: Request) {
    // The useChat hook posts a JSON body witht he entire chat history.
    // We destructure 'messages' - which is an array of { role, content/parts } objects.
    const { messages } = await request.json();

    // Convert UI messages → model messages once, up front.
    // Both the Haiku tool loop AND the Opus synthesis step need this,
    // so we hoist the conversion out of streamText() for reuse.
    // This helper converts the useChat message format into the format expected by the model.
    const modelMessages = await convertToModelMessages(messages);

    // We compose a UI message stream so we can run TWO model calls and
    // merge both into the same client-facing response:
    //   1. Haiku — orchestration / tool loop (cheap, fast)
    //   2. Opus — structured verdict synthesis (expensive, high-quality)
    //
    // This is the AI Gateway model-tiering story made visible: N cheap
    // calls for planning + 1 expensive call for the final answer. Both
    // show up in the Gateway dashboard with separate attribution.
    const stream = createUIMessageStream({
        execute: async ({ writer }) => {
            // ────────────────────────────────────────────────────────────
            // STEP 1: Haiku tool loop
            // ────────────────────────────────────────────────────────────

            // We stream the response synchronously from the AI Gateway.
            const toolLoop = streamText({
                // Model ID is just a plain string
                // AI gateway will resolve it to the actual model endpoint. 🙌🏻
                model: "anthropic/claude-haiku-4-5",

                // System prompt sets the agent's identity and rules.
                // We'll add tools here later...

                system: `You are a real estate deal analyst assistant for DealWave.

                    When a user provides a property address, call analyze_deal first to get
                    underwriting data. analyze_deal returns:
                    - arvEstimate (After Repair Value), arvLow, arvHigh
                    - mao (Maximum Allowable Offer)
                    - estimatedRepairs, estimatedProfit, rentEstimate
                    - dealScore (0-100) and dealGrade (A/B/C/D/F)
                    - topPick (boolean — strong signal)
                    - riskFlags (array of {severity 1-5, message})
                    - confidenceScore (0-100), compCount

                    After analyze_deal returns, you MUST immediately call pull_comps WITHOUT
                    asking the user FIRST when ANY of these signals appear:
                    - confidenceScore < 60
                    - compCount < 3
                    - any riskFlag with severity >= 4 mentioning valuation, ARV, or pricing

                    DO NOT ask the user "would you like me to pull comps?" — just call the
                    tool. The user expects you to autonomously decide based on these signals.
                    Asking for permission on comps wastes a turn and signals you don't
                    understand your own data quality.

                    Only ask about comps if NONE of the above signals fire AND the user might
                    want a deeper second opinion.

                    If the user explicitly asks for comps, call pull_comps regardless.

                    For deal recommendations, ALWAYS cite specific dealGrade, dealScore, and
                    either arvEstimate or mao from the tool results. Surface any riskFlags
                    with severity >= 4 prominently. Never invent numbers — only use values
                    returned by tools.

                    After completing analysis (analyze_deal and optionally pull_comps), if
                    the verdict is strong-deal or good-deal, OFFER to save the deal by calling
                    create_deal. The create_deal tool will pause the loop and ask the user
                    for explicit approval before persisting — never assume permission. When
                    calling create_deal, pass:
                    - address (same one analyzed)
                    - name (optional friendly label)
                    - notes (1-2 sentence summary of the deal: score, strategy, key numbers)
                    - investment_strategy (your recommended strategy)

                    If the user explicitly says "save it" or "save to pipeline" or similar,
                    call create_deal immediately.

                    If the user declines or says skip, acknowledge gracefully and offer to
                    help with the next analysis.

                    Be concise. Lead with the recommendation (strong-deal / good-deal /
                    investigate / pass), then the supporting numbers, then the caveats.
                    If you ran both analyze_deal and pull_comps, briefly mention what the
                    comps confirmed or challenged.`,

                messages: modelMessages,

                // Register tools! 🛠️
                tools: {
                    analyze_deal: analyzeDealTool,
                    pull_comps: pullCompsTool,
                    create_deal: createDealTool,
                },

                // Stop after 8 steps. This helps manage cost and prevents infinite loops if the model gets confused. Adjust as needed.
                stopWhen: stepCountIs(8),

                // Per-step telemetry. Logs which model handled each step and
                // how many tokens it consumed. Sunday this feeds the AI Gateway
                // routing chip in the footer (model + latency + cost per step).
                onStepFinish: ({ finishReason, usage }) => {
                    console.log("[step]", {
                        model: "claude-haiku-4-5",
                        finishReason,
                        usage,
                    });
                },
            });

            // Merge the Haiku stream into our composite stream.
            // Tool calls + text from the loop appear on the client in real time.
            // sendFinish: false because we're going to write more chunks
            // (the Opus verdict) before this composite stream is done.
            writer.merge(
                toolLoop.toUIMessageStream({
                    sendStart: true,
                    sendFinish: false,
                }),
            );

            // Wait for the Haiku loop to finish — we need its tool results
            // in the conversation history for Opus to synthesize from.
            const finalResponse = await toolLoop.response;

            // ────────────────────────────────────────────────────────────
            // STEP 2: Opus structured verdict synthesis
            // ────────────────────────────────────────────────────────────
            //
            // Opus reads the full tool loop + results and emits a typed
            // Verdict. We attach it as a custom data-verdict part so the UI
            // can render the verdict banner + metric tiles + follow-up chips
            // (Sunday's UI work).
            //
            // Skip synthesis when no tools were called (e.g. user asked a
            // general question with no address) — Opus is expensive and
            // synthesis isn't meaningful without tool results.

            // Decide whether to synthesize on THIS turn.
            //
            // Rule: synthesize only when the turn produced new analysis
            // (analyze_deal or pull_comps results) AND did NOT involve
            // create_deal. Skipping create_deal turns means:
            //   - During the approval pause: no new verdict needed
            //   - After the save succeeds: it's just a confirmation, not new analysis
            //
            // We extract tool results directly instead of passing the raw
            // message history. Two reasons:
            //   1. Anthropic rejects ending the conversation on an assistant
            //      message ("does not support assistant message prefill") —
            //      the streamed loop ends with an assistant text response.
            //   2. If create_deal is paused at approval, the history has a
            //      dangling tool-call with no result, which Opus also rejects.
            //
            // Feeding tool results via `prompt` (a single user turn) sidesteps
            // both issues and gives Opus a focused input.
            const analysisResults: { tool: string; output: unknown }[] = [];
            let touchedCreateDeal = false;

            for (const m of finalResponse.messages) {
                if (!Array.isArray(m.content)) continue;
                for (const part of m.content as Array<{
                    type: string;
                    toolName?: string;
                    output?: unknown;
                }>) {
                    if (
                        part.type === "tool-result" &&
                        (part.toolName === "analyze_deal" ||
                            part.toolName === "pull_comps")
                    ) {
                        analysisResults.push({
                            tool: part.toolName,
                            output: part.output,
                        });
                    }
                    if (part.toolName === "create_deal") {
                        touchedCreateDeal = true;
                    }
                }
            }

            // Signal completion of the composite stream.
            writer.write({ type: "finish" });
        },
    });

    // Convert the stream into an HTTP Response with the right framing.
    // This sets the Content-Type: text/event-stream, opens a streaming connection,
    // and emits UI message stream events as the model generates them.
    return createUIMessageStreamResponse({ stream });
}
