# DealWave Agent

An SFR-investor deal analyst built on Next.js + the Vercel AI SDK. Paste a property address, and a Haiku tool loop pulls underwriting data, optionally validates it against comps, then a Sonnet synthesis step renders a typed verdict — score, strategy, metric tiles, risks, and one-click follow-ups including a human-in-the-loop save to your DealWave pipeline.

## What it does

- **Address in → tool loop out.** Haiku orchestrates `analyze_deal` and `pull_comps` against DealWave's REST API, auto-chaining to comps when confidence is low or comp count is thin.
- **Structured verdict.** A second Sonnet call reads the tool results and emits a Zod-validated `Verdict` (recommendation, strategy, dealScore, metric tiles, risks, follow-up chips). Rendered as a `VerdictCard` inline with the assistant message.
- **Human-in-the-loop save.** `create_deal` is gated by AI SDK `needsApproval: true` — the loop pauses on an approval card until the user clicks Save or Skip. On success, a Workflow SDK durable function (`dealReviewWorkflow`) takes over for the post-save review wait.

## Architecture

```
Browser (useChat)
    │
    ▼
POST /api/chat
    │
    ├──► Haiku (orchestration) ──► analyze_deal / pull_comps / create_deal
    │      (via AI Gateway)            (via DealWave /api/v1/)
    │
    ├──► Sonnet (synthesis)    ──► VerdictSchema (Zod)
    │      (via AI Gateway)
    │
    ▼
data-verdict UI part ──► VerdictCard render
                       + follow-up chip click
                       + Save Deal approval gate
                                │
                                ▼
                        start(dealReviewWorkflow)
                                │
                                ▼
                        reviewHook.create (pauses)
                                │
                        POST /api/agent/approve
                                │
                                ▼
                        reviewHook.resume (workflow continues)
```

The chat route composes a single `createUIMessageStream` that merges Haiku's streaming output with the Sonnet `generateObject` result written as a custom `data-verdict` part. The client receives one continuous SSE stream; both model calls show up as separate rows in the AI Gateway dashboard.

## Vercel primitives used

| Primitive | What it does here | File path |
| --- | --- | --- |
| AI Gateway | Plain-string model IDs (`anthropic/claude-haiku-4-5`, `anthropic/claude-sonnet-4-6`) — routing, observability, model tiering | `app/api/chat/route.ts` |
| AI SDK (v6) | `streamText`, `generateObject`, `tool` with `needsApproval`, `useChat`, `createUIMessageStream` | `app/api/chat/route.ts`, `app/page.tsx`, `lib/tools/*.ts` |
| Workflow SDK | `'use workflow'` durable function + `reviewHook` for post-save review, resumed by an API route | `lib/workflows/deal-analyst.ts`, `lib/hooks/approval.ts`, `app/api/agent/approve/route.ts` |
| Zod schemas | Structured-output validation for the synthesis step | `lib/schemas/verdict.ts` |
| AI Elements | Pre-built components consuming `useChat`'s typed parts — Conversation, Message, Tool, PromptInput, Shimmer, Suggestion | `components/ai-elements/` |
| Next.js ISR | Deal detail page rebuilt in the background at most every 60s | `app/deals/[id]/page.tsx` |

## Running locally

Prerequisites: Node 20+, pnpm.

```bash
pnpm install
vercel env pull .env.local --environment=production
pnpm dev
```

Env vars expected in `.env.local`:

| Var | Purpose |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Auth for AI Gateway (Anthropic + OpenAI through one key) |
| `DEALWAVE_API_BASE` | Base URL for DealWave's `/api/v1/` REST surface |
| `DEALWAVE_API_TOKEN` | Bearer token for DealWave API |
| `VERCEL_OIDC_TOKEN` | Optional OIDC-based fallback auth |

`lib/dealwave-client.ts` throws at import-time if `DEALWAVE_API_BASE` or `DEALWAVE_API_TOKEN` is missing. That's intentional — the agent has no graceful-degradation story without DealWave, so fail loud on startup rather than at the first tool call.

## Running the eval

```bash
pnpm eval
```

The eval runs three test cases through the same Haiku + Sonnet pipeline used in production. For each case it asserts on:

- **Tool selection** — which tools the agent autonomously decided to call (catches prompt regressions that break the auto-chain to `pull_comps`)
- **Recommendation** — must land in the expected set
- **`dealScore`** — within the calibrated bounds for that property
- **Narrative markers** — substrings the synthesis should mention
- **Negative cases** — off-topic prompts must NOT emit a verdict

Exit code is `0` on full pass, `1` on any failure. Wire to GitHub Actions to gate PRs.

## Design decisions

- **Sonnet over Opus for synthesis.** The synthesis target is a fixed Zod schema fed pre-validated tool results — Sonnet hits the same structured-output quality at ~2-3× faster and ~1/5 the cost. Opus is overkill for this shape.
- **Two-step Haiku → Sonnet** rather than a single Sonnet call. Tool orchestration is cheap, parallelizable work; structured synthesis is the expensive part. Cost tiering makes both steps observable in the Gateway dashboard.
- **In-process `needsApproval` for the save** + **Workflow SDK for the post-save review.** The save approval lives inside one chat turn (sub-30s wait) — in-process pause is the right size. The post-save review may wait minutes to days — needs durable execution.
- **`prompt` (not `messages`) for `generateObject`.** Anthropic rejects ending a conversation on an assistant message, and the Haiku loop always ends with assistant text. Feeding tool results as a single user turn sidesteps that and avoids the dangling-tool-call error when `create_deal` is paused at approval.
- **Bearer auth via explicit API key.** OIDC works as a fallback, but the explicit `AI_GATEWAY_API_KEY` makes localhost requests attribute to the project correctly (where the OIDC path is harder to wire up).
- **Structured output as the eval target.** Asserting on free-text narratives is noisy; the Zod-validated `Verdict` gives us discrete fields (`recommendation`, `dealScore`, `recommendedStrategy`) that drift cleanly catches prompt-tuning regressions.
- **No client-side Zod.** `VerdictCard` mirrors the Verdict type structurally and trusts server validation. Keeps Zod out of the client bundle.

## Known limitations

- **Localhost requests file under "No Project" in AI Gateway.** Project attribution works on deployed traffic. Accepted tradeoff for dev velocity.
- **Duplicate saves fail with 500.** DealWave's `unified_deals` table has `UNIQUE (account_id, lower(address))` — re-saving the same address returns a server error. Should be upserted upstream.
- **No streaming on verdict synthesis.** The verdict appears as one chunk after a 3-5s shimmer. `streamObject` upgrade is future work.
- **Approval pause is in-process only.** Refreshing the page during an approval-requested state drops the loop. The Workflow SDK migration path is documented in `lib/workflows/deal-analyst.ts`.

## Project structure

```
app/
  api/
    chat/route.ts            Haiku tool loop + Sonnet synthesis, single SSE stream
    agent/approve/route.ts   Resumes dealReviewWorkflow via reviewHook
  deals/[id]/page.tsx        ISR deal detail (revalidate: 60)
  page.tsx                   useChat shell + VerdictCard render + approval buttons
  layout.tsx, globals.css

lib/
  dealwave-client.ts         Centralized fetch, Bearer auth, 30s timeout
  hooks/approval.ts          reviewHook definition (Workflow SDK)
  schemas/verdict.ts         Zod VerdictSchema (synthesis target)
  tools/                     analyze-deal, pull-comps, create-deal
  workflows/deal-analyst.ts  dealReviewWorkflow (durable)

components/
  ai-elements/               Conversation, Message, Tool, PromptInput, Shimmer…
  dealwave/verdict-card.tsx  Banner + metric tiles + risks + follow-up chips
  ui/                        shadcn primitives

evals/
  run.ts                     Regression eval (Haiku tool selection + Sonnet verdict)
  test-cases.json            Three cases incl. one negative
```
