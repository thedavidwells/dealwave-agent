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

                    End your analysis with the recommendation and supporting numbers.
                    DO NOT ask the user "would you like to save this?" or "should I save
                    this to your pipeline?" — a structured verdict card will render below
                    your text response with the recommendation pill, metric tiles, and
                    clickable follow-up chips (including "Save to pipeline" when applicable).
                    Those chips handle next-step actions. Your job is the analysis prose;
                    the verdict card handles the call-to-action.

                    When the user clicks a "Save to pipeline" chip OR explicitly says
                    "save it" / "save to pipeline" / "yes save" / "add it" or similar —
                    call create_deal IMMEDIATELY. Do NOT first write a confirmation text
                    restating the deal details. The user just saw the full verdict card
                    above with metric tiles, score, recommendation, and risks; restating
                    that in prose adds nothing and forces an extra round-trip. The
                    create_deal tool itself pauses the loop for the final approval via
                    a UI button (Save Deal / Skip) — that IS the hard confirmation step.
                    Your text response after their request should be brief, like
                    "Saving…" or nothing at all; the approval card will appear inline.

                    Pass to create_deal: address, name (short label like "Phoenix SFR
                    Flip"), notes (1-2 sentence summary with score/strategy/key numbers
                    so the user has context when they revisit), investment_strategy
                    matching the verdict's recommendedStrategy.

                    If the user clicks Skip in the approval card OR explicitly declines
                    in text, acknowledge briefly and offer to help with the next analysis.

                    Be concise. Lead with the recommendation (strong-deal / good-deal /
                    investigate / pass), then the supporting numbers, then the caveats.
                    If you ran both analyze_deal and pull_comps, briefly mention what
                    the comps confirmed or challenged. STOP after the analysis — do not
                    trail with questions.`,

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

            const shouldSynthesize =
                analysisResults.length > 0 && !touchedCreateDeal;

            if (shouldSynthesize) {
                try {
                    const { object: verdict } = await generateObject({
                        // Sonnet for the final synthesis: same structured-output
                        // quality as Opus for this task (validated tool results →
                        // fixed schema), but ~2-3x faster and ~1/5th the cost.
                        // Shows up in the AI Gateway dashboard as a SEPARATE row
                        // from Haiku — the demo proof of model tiering. 🎯
                        model: "anthropic/claude-sonnet-4-6",
                        schema: VerdictSchema,
                        system: `You synthesize a real-estate deal analysis into a
                            structured verdict for a single-family investor.

                            Use ONLY values from the tool results provided. Never invent figures.
                            If pull_comps wasn't called, set dataConfidence based on analyze_deal's
                            confidenceScore alone.

                            Pick the recommendedStrategy that maximizes this deal's economics:
                            - wholesale: wide spread, light repairs
                            - flip: strong ARV, repair scope justified by profit
                            - buy-and-hold: strong rent estimate, reasonable cash flow
                            - brrrr: strong ARV + manageable repairs (refinance candidate)

                            Metric tiles: pick 4-6 tiles relevant to the chosen strategy.
                            - For flip → ARV, Repairs, Est. Profit, dealScore
                            - For buy-and-hold → ARV, Rent Est., dealScore, equity position
                            - For wholesale → ARV, MAO, Spread, Repairs

                            Health logic per tile:
                            - "strong" (green): above the conventional target for that metric under that strategy
                            - "concern" (red): below target / problem signal
                            - "neutral" (white): informational / no pass-fail judgment

                            shouldOfferSave = true for strong-deal / good-deal verdicts.`,
                        // Single user turn with the tool results as JSON.
                        // Conversation ends with user → Anthropic accepts;
                        // no dangling tool calls → no MissingToolResults error.
                        prompt: `Synthesize a structured Verdict from these tool results:

${JSON.stringify(analysisResults, null, 2)}`,
                    });

                    // Write the verdict as a custom data part. The client's
                    // useChat receives a 'data-verdict' part; page.tsx renders
                    // it as a VerdictCard (banner + metric tiles + chips).
                    writer.write({
                        type: "data-verdict",
                        data: verdict,
                    });

                    console.log("[synthesis]", {
                        model: "claude-sonnet-4-6",
                        recommendation: verdict.recommendation,
                        strategy: verdict.recommendedStrategy,
                    });
                } catch (synthErr) {
                    // Synthesis failure shouldn't break the chat — the
                    // streamed text from Haiku stands alone as a fallback.
                    console.error("[synthesis-failed]", synthErr);
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
