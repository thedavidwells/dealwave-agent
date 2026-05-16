import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { analyzeDealTool } from "@/lib/tools/analyze-deal";

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

When a user provides a property address, call analyze_deal to get
underwriting data. The tool returns:
- arvEstimate (After Repair Value), arvLow, arvHigh
- mao (Maximum Allowable Offer)
- estimatedRepairs, estimatedProfit, rentEstimate
- dealScore (0-100) and dealGrade (A/B/C/D/F)
- topPick (boolean — strong signal)
- riskFlags (array of {severity 1-5, message})
- confidenceScore (0-100), compCount

For deal recommendations, ALWAYS cite the specific dealGrade, dealScore,
and either arvEstimate or mao from the result. Surface any riskFlags
with severity >= 4 prominently. Never make up numbers — only use values
the tools returned.

If confidenceScore < 60 or compCount < 3, tell the user the analysis
is preliminary and suggest calling pull_comps for market validation.

Be concise. Lead with the recommendation (buy/pass/investigate), then
the supporting numbers, then the caveats.`,

        messages: await convertToModelMessages(messages), // This helper converts the useChat message format into the format expected by the model.

        // Register tools! 🛠️
        tools: {
            analyze_deal: analyzeDealTool,
        },

        // Stop after 8 steps. This helps manage cost and prevents infinite loops if the model gets confused. Adjust as needed.
        stopWhen: stepCountIs(8),
    });

    // Convert the stream into an HTTP Response with the right framing.
    // This sets the Content-Type: text/event-stream, opens a streaming connection,
    // and emits UI message stream events as the model generates them.
    return result.toUIMessageStreamResponse();
}
