import {
    Output,
    generateText,
    streamText,
    convertToModelMessages,
    stepCountIs,
    createUIMessageStreamResponse,
    createUIMessageStream,
} from "ai";
import { analyzeDealTool } from "@/lib/tools/analyze-deal";
import { pullCompsTool } from "@/lib/tools/pull-comps";
import { createDealTool } from "@/lib/tools/create-deal";
import { listDealsTool } from "@/lib/tools/list-deals";
import { runWhatIfTool } from "@/lib/tools/run-what-if";
import { updateDealTool } from "@/lib/tools/update-deal";
import { VerdictSchema } from "@/lib/schemas/verdict";

// (We'll leave the runtime as Node.js default for now.
// Edge runtime would also work for streaming, but Workflow SDK will require node.)
//
// This handler streams live model output and tool results, so we do not
// try to cache it. No special segment config is needed — route handlers
// that produce per-request SSE are naturally request-time work.

// Allow up to 60s for the full research loop + advisor step.
// (Default Next.js function timeout on Hobby/Pro is 10s - we need more because
// analyse_deal alone can take 15-30s seconds on first time properties, and the
// advisor step adds another ~2-5s after the research loop completes.)
export const maxDuration = 60;

// Allowlist of models the client is permitted to pick. Server-side
// validation is the source of truth — anything the client sends that
// isn't here gets silently replaced with the corresponding default.
// Defense against a stale localStorage value, a tampered request, or
// a UI build that lags the server's idea of what's available.
//
// Naming mirrors the UI dropdowns:
//   research → tool-loop model (pulls property data, runs comps)
//   advisor  → verdict model (interprets data, picks strategy)
//   backup   → optional gateway provider used only when primary is down
const ALLOWED_RESEARCH = [
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
] as const;
const ALLOWED_ADVISOR = [
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-opus-4-6",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-4o",
] as const;
const ALLOWED_BACKUP = ["none", "bedrock", "vertex"] as const;

const DEFAULT_RESEARCH: (typeof ALLOWED_RESEARCH)[number] =
    "anthropic/claude-haiku-4-5";
const DEFAULT_ADVISOR: (typeof ALLOWED_ADVISOR)[number] =
    "anthropic/claude-sonnet-4-6";
const DEFAULT_BACKUP: (typeof ALLOWED_BACKUP)[number] = "none";

function pickAllowed<T extends readonly string[]>(
    candidate: unknown,
    allowed: T,
    defaultValue: T[number],
    label: string,
): T[number] {
    if (
        typeof candidate === "string" &&
        (allowed as readonly string[]).includes(candidate)
    ) {
        return candidate as T[number];
    }
    if (candidate !== undefined) {
        // Log once per unknown value so a stale UI release shows up in
        // the function logs without breaking the request.
        console.warn(
            `[models] rejecting ${label}='${candidate}', using default '${defaultValue}'`,
        );
    }
    return defaultValue;
}

// Build providerOptions.gateway for a given model + backup choice.
// The Vercel AI Gateway exposes `order` as a list of provider IDs to
// try in sequence — useful when we want resilience to a primary
// provider blip. We prepend the model's native provider (anthropic /
// openai) and append the user-selected backup. `none` returns undef
// so the gateway uses its default routing.
function gatewayOptions(model: string, backup: string) {
    if (backup === "none") return undefined;
    const primary = model.split("/")[0];
    return {
        gateway: {
            order: [primary, backup],
        },
    };
}

export async function POST(request: Request) {
    // The useChat hook posts a JSON body witht he entire chat history.
    // We destructure 'messages' - which is an array of { role, content/parts } objects.
    // `models` is sent by the client's model selector (see app/page.tsx and
    // components/dealwave/model-selector.tsx) and is optional — absent on
    // older clients or programmatic callers.
    const { messages, models: clientModels } = await request.json();

    const researchModel = pickAllowed(
        clientModels?.research,
        ALLOWED_RESEARCH,
        DEFAULT_RESEARCH,
        "research",
    );
    const advisorModel = pickAllowed(
        clientModels?.advisor,
        ALLOWED_ADVISOR,
        DEFAULT_ADVISOR,
        "advisor",
    );
    const backupProvider = pickAllowed(
        clientModels?.backup,
        ALLOWED_BACKUP,
        DEFAULT_BACKUP,
        "backup",
    );

    // Convert UI messages → model messages once, up front.
    // Both the research tool loop AND the advisor step need this,
    // so we hoist the conversion out of streamText() for reuse.
    // This helper converts the useChat message format into the format expected by the model.
    const modelMessages = await convertToModelMessages(messages);

    // We compose a UI message stream so we can run TWO model calls and
    // merge both into the same client-facing response:
    //   1. Research — tool loop, pulls property data + runs comps (cheap, fast)
    //   2. Advisor  — structured verdict, interprets data + picks strategy
    //
    // The createUIMessageStream function allows you to create a readable stream for UI messages
    // with advanced features like message merging, error handling, and finish callbacks.
    //
    // https://ai-sdk.dev/docs/reference/ai-sdk-ui/create-ui-message-stream
    //
    const stream = createUIMessageStream({
        execute: async ({ writer }) => {
            // ────────────────────────────────────────────────────────────
            // STEP 1: Research tool loop
            // ────────────────────────────────────────────────────────────

            // We stream the response synchronously from the AI Gateway.
            const toolLoop = streamText({
                // Model ID is just a plain string
                // AI gateway will resolve it to the actual model endpoint. 🙌🏻
                // Defaults to claude-haiku-4-5 but the client's Research
                // dropdown (see components/dealwave/model-selector.tsx) can
                // swap this on a per-request basis.
                model: researchModel,
                providerOptions: gatewayOptions(researchModel, backupProvider),

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

                    ALSO pass through enrichment fields from analyze_deal so the user's
                    My Deals dashboard AND the /deals/[id] detail page show full data.
                    Map analyze_deal output to create_deal input:

                    Economics:
                      property_image_url  ← analyze_deal.imageUrl OR propertyDetails.imageUrl
                      arv_estimate        ← analyze_deal.arvEstimate
                      arv_high            ← analyze_deal.arvHigh
                      mao                 ← analyze_deal.mao
                      estimated_repairs   ← analyze_deal.estimatedRepairs
                      profit_spread       ← analyze_deal.estimatedProfit
                      deal_score          ← analyze_deal.dealScore
                      deal_grade          ← analyze_deal.dealGrade

                    Property characteristics (populate PropertyInfoCard on the
                    detail page) — these are TOP-LEVEL fields on analyze_deal's
                    response, NOT nested under propertyDetail:
                      beds                ← analyze_deal.beds
                      baths               ← analyze_deal.baths
                      sqft                ← analyze_deal.sqft
                      year_built          ← analyze_deal.yearBuilt
                      property_type       ← analyze_deal.propertyType
                      lot_size            ← analyze_deal.lotSize

                    Pass only the fields the analyze_deal result actually returned;
                    omit any that were undefined.

                    Monte Carlo (only present if run_what_if ran THIS turn):
                      monte_carlo         ← numeric summary from run_what_if:
                                            { p10, p50, p90, probability_of_loss,
                                              value_at_risk_95, trials,
                                              interpretation }

                    CRITICAL: do NOT include histogram_png_base64 in the
                    monte_carlo object. That field is 30-50KB and the model
                    would have to regenerate the entire base64 string
                    character-by-character to forward it — blocking the save
                    for minutes. Only pass the numeric fields above. The
                    histogram is already rendered inline in chat; the saved
                    deal record only needs the numbers.

                    When create_deal succeeds, the tool result contains a 'deal' object
                    with an 'id' field (e.g. deal.id = "abc-123"). Your confirmation
                    text MUST include a markdown link to the deal's detail page using
                    the EXACT format: [View this deal →](/deals/<deal-id>) — substituting
                    the real id from the tool result. Example confirmation:
                    "✅ Saved 2852 NW 14th St to your pipeline. [View this deal →](/deals/abc-123)"
                    Never invent or guess a deal id — use only the id from the tool
                    result. If the tool result somehow lacks an id, omit the link
                    rather than fabricating one.

                    If the user clicks Skip in the approval card OR explicitly declines
                    in text, acknowledge briefly and offer to help with the next analysis.

                    UPDATE_DEAL — call this to attach data to an ALREADY-SAVED deal.
                    The most common case: the user saved a deal, then ran a Monte
                    Carlo (run_what_if) on it, and now wants the MC result to show
                    up on the deal's detail page. Pass deal_id (from the prior
                    create_deal result's deal.id) and monte_carlo (the full
                    run_what_if output object). Also usable to update notes or move
                    pipeline_status. PATCH semantics: fields you omit are preserved
                    server-side. Always call this AFTER run_what_if runs IF the
                    deal was already saved in the same conversation. Do NOT call
                    if the deal hasn't been saved yet — pass monte_carlo through
                    create_deal instead.

                    RUN_WHAT_IF — call this AFTER analyze_deal when the user wants to
                    understand the *risk* or *variance* of a deal, not just the point
                    estimate. Trigger phrases: "how risky is this deal?", "what's the
                    downside?", "what if repairs come in higher?", "sensitivity
                    analysis", "monte carlo", "stress test", "show me the distribution".
                    The baseline values (arv, purchase_price, repairs) MUST come from
                    the most recent analyze_deal result for this address — never
                    invent them. Map analyze_deal fields to the tool's baseline:
                      arv             ← analyze_deal.arvEstimate
                      purchase_price  ← analyze_deal.listingPrice (if present) else mao
                      repairs         ← analyze_deal.estimatedRepairs
                    Default holding_months to 4 unless the analysis indicated otherwise.

                    After run_what_if returns, in your response: (1) state the P50
                    (median) profit and probability of loss in plain English, (2)
                    reference the 95% Value-at-Risk as the worst-case to plan around,
                    (3) if probability of loss > 20%, surface that as a major risk.
                    DO NOT include the histogram_png_base64 string in your text
                    response — the UI renders it separately.

                    PIPELINE QUERIES — call list_deals ONLY when the user asks about
                    their existing saved deals, pipeline, or deal history. Trigger
                    examples: "show me my recent deals", "what was my last deal in
                    Boise?", "any wholesale deals saved?", "what's in my pipeline?",
                    "show me deals with status X". DO NOT call list_deals during a
                    fresh property analysis where the user gave an address (use
                    analyze_deal for that). After list_deals returns, format the
                    response as a markdown table with columns: Address, Score (if
                    present), Strategy (if present), Status, and View. The View
                    column MUST contain a markdown link [View →](/deals/<id>) using
                    each row's real id from the tool result — never invent ids. If
                    the result is empty, say so plainly ("No deals match those
                    filters."). If only 1-2 rows came back, a short bulleted list is
                    fine instead of a table.

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
                    list_deals: listDealsTool,
                    run_what_if: runWhatIfTool,
                    update_deal: updateDealTool,
                },

                // Stop after 12 steps. Bumped from 10 to leave headroom for
                // chained flows like "analyze → comps → save → run_what_if
                // → update_deal" (six tool turns + narration).
                stopWhen: stepCountIs(12),

                // Per-step telemetry. Logs which research model handled
                // each step and how many tokens it consumed — useful for
                // an AI Gateway routing chip in the footer (model +
                // latency + cost per step).
                onStepFinish: ({ finishReason, usage }) => {
                    console.log("[step]", {
                        model: researchModel,
                        finishReason,
                        usage,
                    });
                },
            });

            // Merge the research stream into our composite stream.
            // Tool calls + text from the loop appear on the client in real time.
            // sendFinish: false because we're going to write more chunks
            // (the advisor's verdict) before this composite stream is done.
            writer.merge(
                toolLoop.toUIMessageStream({
                    sendStart: true,
                    sendFinish: false,
                }),
            );

            // Wait for the research loop to finish — we need its tool
            // results in the conversation history for the advisor to
            // build a verdict from.
            const finalResponse = await toolLoop.response;

            // ────────────────────────────────────────────────────────────
            // STEP 2: Advisor verdict (structured output)
            // ────────────────────────────────────────────────────────────
            //
            // The advisor reads the full research loop + results and emits
            // a typed Verdict. We attach it as a custom data-verdict part
            // so the UI can render the verdict banner + metric tiles +
            // follow-up chips.
            //
            // Skip the advisor step when no tools were called (e.g. user
            // asked a general question with no address) — the advisor
            // model is expensive and a verdict isn't meaningful without
            // tool results.

            // Decide whether to run the advisor on THIS turn.
            //
            // Rule: produce a verdict only when the turn yielded new
            // analysis (analyze_deal or pull_comps results) AND did NOT
            // involve create_deal. Skipping create_deal turns means:
            //   - During the approval pause: no new verdict needed
            //   - After the save succeeds: it's just a confirmation, not new analysis
            //
            // We extract tool results directly instead of passing the raw
            // message history. Two reasons:
            //   1. Anthropic rejects ending the conversation on an assistant
            //      message ("does not support assistant message prefill") —
            //      the streamed loop ends with an assistant text response.
            //   2. If create_deal is paused at approval, the history has a
            //      dangling tool-call with no result, which the advisor
            //      model also rejects.
            //
            // Feeding tool results via `prompt` (a single user turn) sidesteps
            // both issues and gives the advisor a focused input.
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

            // Skip the advisor when there's no *successful* analysis to
            // summarize. The agent's tools emit { error: true, ... } envelopes
            // when DealWave's /analyze or /comps returns a 500 (e.g. address
            // not in REAPI, pipeline transient failure). Feeding those to
            // running the structured-output advisor step is worse than
            // skipping: the model produces a
            // truncated "everything failed" object with 1-2 metrics, then Zod
            // rejects it for failing min(4) on the metrics array, then the
            // user sees a chat response with no verdict card. Better to
            // gracefully render no verdict and let the model's error-handling
            // prose stand alone.
            const hasSuccessfulAnalysis = analysisResults.some((r) => {
                const out = r.output as { error?: boolean } | null | undefined;
                return out != null && out.error !== true;
            });
            const shouldAdvise = hasSuccessfulAnalysis && !touchedCreateDeal;

            if (shouldAdvise) {
                try {
                    const { output: verdict } = await generateText({
                        // Sonnet default for the advisor step: same
                        // structured-output quality as Opus on this kind
                        // of task (validated tool results → fixed schema),
                        // but roughly 2-3x faster and 1/5th the cost.
                        // Appears as a separate row in the AI Gateway
                        // dashboard so per-step cost and latency are
                        // observable per model tier.
                        model: advisorModel,
                        providerOptions: gatewayOptions(
                            advisorModel,
                            backupProvider,
                        ),
                        output: Output.object({
                            schema: VerdictSchema,
                        }),
                        system: `You produce a real-estate deal analysis as a
                            structured verdict for a single-family investor.

                            Use ONLY values from the tool results provided. Never invent figures.
                            If pull_comps wasn't called, set dataConfidence based on analyze_deal's
                            confidenceScore alone.

                            FOLLOW-UPS — always include a "Run a Monte Carlo on this deal" chip
                            when the analyze_deal result has arvEstimate, estimatedRepairs, and
                            either mao or listingPrice (i.e., the baseline numbers exist to seed
                            a simulation). Phrase it short: "Run Monte Carlo" or "Stress-test the
                            numbers" or "Show downside scenarios". This routes to the run_what_if
                            Sandbox tool — surface it as a follow-up especially when dataConfidence
                            is medium/low or when any severity-4+ risk flag exists, because that's
                            exactly where variance matters most. Also include "Save to pipeline"
                            for strong-deal / good-deal verdicts.

                            Pick the recommendedStrategy that maximizes this deal's economics:
                            - wholesale: wide spread, light repairs
                            - flip: strong ARV, repair scope justified by profit
                            - buy-and-hold: strong rent estimate, reasonable cash flow
                            - brrrr: strong ARV + manageable repairs (refinance candidate)

                            Metric tiles: pick 4-6 tiles relevant to the chosen strategy.
                            - For flip → ARV, Repairs, Est. Profit, dealScore
                            - For buy-and-hold → ARV, Rent Est., dealScore, equity position
                            - For wholesale → ARV, MAO, Spread, Repairs

                            Nullable tile fields — emit null when they don't apply:
                            - rangeLow / rangeHigh: only meaningful for ARV tiles where DealWave
                              returned arvLow/arvHigh. For every other tile, set both to null.
                            - context: short context line under the value (e.g. "After Repair
                              Value"). Set to null when no extra context is needed.

                            Health logic per tile:
                            - "strong" (green): above the conventional target for that metric under that strategy
                            - "concern" (red): below target / problem signal
                            - "neutral" (white): informational / no pass-fail judgment

                            shouldOfferSave = true for strong-deal / good-deal verdicts.`,
                        // Single user turn with the tool results as JSON.
                        // Conversation ends with user → Anthropic accepts;
                        // no dangling tool calls → no MissingToolResults error.
                        prompt: `Produce a structured Verdict from these tool results:

                            ${JSON.stringify(analysisResults, null, 2)}`,
                    });

                    // Write the verdict as a custom data part. The client's
                    // useChat receives a 'data-verdict' part; page.tsx renders
                    // it as a VerdictCard (banner + metric tiles + chips).
                    writer.write({
                        type: "data-verdict",
                        data: verdict,
                    });

                    console.log("[advisor]", {
                        model: advisorModel,
                        recommendation: verdict.recommendation,
                        strategy: verdict.recommendedStrategy,
                    });
                } catch (advisorErr) {
                    // Advisor failure shouldn't break the chat — the
                    // streamed text from the research step stands alone
                    // as a graceful degradation.
                    console.error("[advisor-failed]", advisorErr);
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
