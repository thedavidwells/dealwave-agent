"use client";
// The 'use client' directive tells Next.js that this page is a client component.
// Client components are components that are rendered on the client side.
// This means that the component will be rendered on the client side and not on the server side.
// This is useful for components that need to interact with the browser API.

// The 'use client is requred because useChat manages state, usees fetch streaming, and renders interactively.
// Without it, this is a server component and the hook will crash at build time.

import { useChat } from "@ai-sdk/react";

export default function Home() {
  // useChat manages the full conversation state.
  // Internally it:
  //    1. Holds the messages array in React state.
  //    2. POSTs to /api/chat with { messages } whenever sendMessage() is called
  //    3. Streams the response back to the client via SSE.
  //    4. Parses the UI message stream events and appends them to messages
  //    5. Re-renders this component on every update.
  const { messages, sendMessage, status } = useChat();

  // Local sate for the inpur box (useChat v5 doesn't manage input state itself).
  const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const input = (form.elements.namedItem("prompt") as HTMLInputElement).value;

    if (!input.trim()) return;

    // sendMessage triggers the POST to /api/chat with the new user message
    // appended to the existing message history.
    sendMessage({ text: input });
    form.reset();
  };
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "40px auto",
        padding: 16,
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>DealWave Deal Analyst</h1>

      {/* Conversation history.
          messages[].parts is an array of typed parts: { type: 'text', text }, etc.
          For now we only render text parts. When we add tools tomorrow, we'll
          add cases for tool-call, tool-result, and needs-approval part types. */}
      <div style={{ marginBottom: 24 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ margin: "12px 0" }}>
            <strong>{m.role === "user" ? "You" : "Agent"}:</strong>{" "}
            {m.parts?.map((part, i) =>
              part.type === "text" ? <span key={i}>{part.text}</span> : null,
            )}
          </div>
        ))}
      </div>

      {/* Status indicator — shows when the model is thinking/streaming.
          status: 'ready' | 'submitted' | 'streaming' | 'error' */}
      {status === "streaming" && (
        <div style={{ color: "#888" }}>Agent is thinking…</div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          name="prompt"
          placeholder="Ask about a deal…"
          style={{ flex: 1, padding: 8, fontSize: 16 }}
          disabled={status === "streaming" || status === "submitted"}
        />
        <button
          type="submit"
          disabled={status === "streaming" || status === "submitted"}
          style={{ padding: "8px 16px" }}
        >
          Send
        </button>
      </form>
    </main>
  );
}
