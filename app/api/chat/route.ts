import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { analyzeDealTool } from "@/lib/tools/analyze-deal";
import { pullCompsTool } from "@/lib/tools/pull-comps";
import { createDealTool } from "@/lib/tools/create-deal";
import { create } from "domain";

// Disable Next.js's default response caching for this route
// AI responses are dynamic per-request - so we don't want to cache them

// (We'll leave the runtime as Node.js default for now.
// Edge runtime would also work for streaming, but Workflow SDK will require node.)

export const dynamic = "force-dynamic";

// Allow up to 60s for the full agent loop.
// (Default Next.js function timeout on Hobby/Pro is 10s - we need more because
// analyse_deal alone can take 15-30s seconds on first time properties.)
export const maxDuration = 60;

export async function POST(request: Request) {
    // The useChat hook posts a JSON body witht he entire chat history.
    // We destructure 'messages' - which is an array of { role, content/parts } objects.
    const { messages } = await request.json();

    // We stream the response synchronously from the AI Gateway.
    const result = streamText({
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

            After analyze_deal returns, ALSO call pull_comps if you see ANY of:
            - confidenceScore < 60
            - compCount < 3
            - any riskFlag with severity >= 4 mentioning valuation, ARV, or pricing

            pull_comps returns recent comparable sales (address, price, sqft, beds,
            baths, distance, daysOld). Use it to either:
            - Confirm the analyze_deal ARV is realistic (comps cluster near arvEstimate)
            - Challenge the ARV if comps are scattered or much lower/higher

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

        messages: await convertToModelMessages(messages), // This helper converts the useChat message format into the format expected by the model.

        // Register tools! 🛠️
        tools: {
            analyze_deal: analyzeDealTool,
            pull_comps: pullCompsTool,
            create_deal: createDealTool,
        },

        // Stop after 8 steps. This helps manage cost and prevents infinite loops if the model gets confused. Adjust as needed.
        stopWhen: stepCountIs(8),
    });

    // Convert the stream into an HTTP Response with the right framing.
    // This sets the Content-Type: text/event-stream, opens a streaming connection,
    // and emits UI message stream events as the model generates them.
    return result.toUIMessageStreamResponse();
}
