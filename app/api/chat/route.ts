import { streamText, convertToModelMessages } from "ai";

// Disable Next.js's default response caching for this route
// AI responses are dynamic per-request - so we don't want to cache them

// (We'll leave the runtime as Node.js default for now.
// Edge runtime would also work for streaming, but Workflow SDK will require node.)

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    // The useChat hook posts a JSON body witht he entire chat history.
    // We destructure 'messages' - which is an array of { role, content/parts } objects.
    const { messages } = await request.json();

    // We stream the response synchronously from the AI Gateway.
    const result = streamText({
        // Model ID is just a plain string
        // AI gateway will resolve it to the actual model endpoint. 🙌🏻
        model: 'anthropic/claude-haiku-4-5',

        // System prompt sets the agent's identity and rules.
        // We'll add tools here later...

        system: 
            'You are a real estate deal analyst assistant for DealWave. ' +
            'Keep responses concise and substantive. ' +
            'If asked about a property, tell the user you\'ll have tools to analyze it soon — ' +
            'for now you can only chat. (Tools coming soon...)',

        messages: await convertToModelMessages(messages), // This helper converts the useChat message format into the format expected by the model.
        
    });

    // Convert the stream into an HTTP Response with the right framing.
    // This sets the Content-Type: text/event-stream, opens a streaming connection,
    // and emits UI message stream events as the model generates them.
    return result.toUIMessageStreamResponse();
    
}