# DealWave Agent

An SFR-investor deal analyst built on Next.js + the Vercel AI SDK. Paste a property address, and a research tool loop pulls underwriting data, optionally validates it against comps, then an advisor step renders a typed verdict — score, strategy, metric tiles, risks, and one-click follow-ups including a human-in-the-loop save to your DealWave pipeline.

## What it does

- **Address in → tool loop out.** The research model drives six tools against DealWave's REST API: `analyze_deal` + `pull_comps` (auto-chains to comps when confidence is low or comp count is thin), `list_deals` + `update_deal` for pipeline management, `create_deal` (needsApproval-gated, see below), and `run_what_if` for sensitivity analysis.
- **Structured verdict.** A second advisor call reads the tool results and emits a Zod-validated `Verdict` (recommendation, strategy, dealScore, metric tiles, risks, follow-up chips). Rendered as a `VerdictCard` inline with the assistant message.
- **Human-in-the-loop save.** `create_deal` is gated by AI SDK `needsApproval: true` — the loop pauses on an approval card until the user clicks Save or Skip. On success, the tool's `execute` fires `start(dealReviewWorkflow)`, a Workflow SDK durable function that survives cold starts and waits for the post-save review.
- **Sandboxed Monte Carlo.** `run_what_if` spawns a `@vercel/sandbox` python3.13 runtime, installs numpy + matplotlib, runs 10,000 trials varying ARV/repairs/holding-time per a model-generated transform, and returns P10/P50/P90 + a histogram PNG. Code executed in isolation, no host access.

## Architecture

### Agent request flow

```
Browser (useChat)
    │
    ▼
POST /api/chat
    │
    ▼
AI Gateway (model routing, per-call cost observability)
    │
    ├──► Research loop  ── streamText({ tools, stopWhen: stepCountIs(12) })
    │       │
    │       ├── analyze_deal  ─┐
    │       ├── pull_comps     ├──► DealWave /api/v1/  (Bearer auth, 60s timeout)
    │       ├── list_deals     │
    │       ├── update_deal    ─┘
    │       │
    │       ├── create_deal  ── needsApproval (loop pauses in-process)
    │       │                       │
    │       │                user clicks Save (addToolApprovalResponse)
    │       │                       │
    │       │                       ▼
    │       │                  tool execute() runs
    │       │                       │
    │       │                       ├──► POST /deals  (DealWave persists)
    │       │                       └──► start(dealReviewWorkflow)  (fire-and-forget)
    │       │
    │       └── run_what_if  ──► @vercel/sandbox (python3.13)
    │                              │
    │                              ▼
    │                         10k-trial Monte Carlo
    │                         → P10/P50/P90 + histogram PNG
    │
    └──► Advisor (gated: hasSuccessfulAnalysis && !touchedCreateDeal)
            │
            ▼
        generateObject({ schema: VerdictSchema })
            │
            ▼
        data-verdict UI part ──► VerdictCard render
                                 (banner + metric tiles + narrative + risks + chips)
```

### Durable workflow lifecycle (separate from the chat request)

```
start(dealReviewWorkflow)
    │
    ▼
'use workflow' directive ── durable; state survives serverless cold starts
    │
    ▼
reviewHook.create({ token: dealId }) ── paused (0 compute, may wait days)
    │
POST /api/agent/approve  (user marks deal reviewed in the UI later)
    │
    ▼
reviewHook.resume(dealId, decision) ── workflow continues
```

The chat route composes a single `createUIMessageStream` that merges the research model's streaming output with the advisor's `generateObject` result written as a custom `data-verdict` part. The client receives one continuous SSE stream; both model calls show up as separate rows in the AI Gateway dashboard.

## Vercel primitives used

| Primitive | What it does here | File path |
| --- | --- | --- |
| AI Gateway | Plain-string model IDs (`anthropic/claude-haiku-4-5`, `anthropic/claude-sonnet-4-6`, `openai/gpt-4o`) — routing, per-call cost observability, model tiering | `app/api/chat/route.ts` |
| AI SDK (v6) | `streamText`, `generateObject`, `tool` with `needsApproval`, `useChat`, `createUIMessageStream` | `app/api/chat/route.ts`, `app/page.tsx`, `lib/tools/*.ts` |
| Workflow SDK | `'use workflow'` durable function + `reviewHook` for post-save review, resumed by an API route. Pause is free (0 compute) and may sit for days. | `lib/workflows/deal-analyst.ts`, `lib/hooks/approval.ts`, `app/api/agent/approve/route.ts` |
| Sandbox | Isolated python3.13 runtime called by `run_what_if`. Spawns a sandbox, installs numpy + matplotlib, runs 10,000-trial Monte Carlo against a model-generated transform expression, returns P10/P50/P90 + histogram PNG. Code-execution surface with no host access — model-generated code can't read env vars or hit the network outside the sandbox. | `lib/tools/run-what-if.ts`, `scripts/sandbox-smoke.ts` |
| Zod schemas | Structured-output validation for the advisor step — `VerdictSchema` uses `.nullable()` (not `.optional()`) for OpenAI strict-mode compatibility so the same schema works across providers | `lib/schemas/verdict.ts` |
| AI Elements | Pre-built components consuming `useChat`'s typed parts — Conversation, Message, Tool, PromptInput, Shimmer, Suggestion | `components/ai-elements/` |
| Next.js ISR | Deal detail page rebuilt in the background at most every 60s, with the comps section streamed via Suspense for freshness | `app/deals/[id]/page.tsx` |
| Next.js PPR | Saved-deals index — static shell prerendered at build time, deal cards stream in via Suspense from per-request DealWave fetches. Enabled globally via `cacheComponents: true` in `next.config.ts`. | `app/deals/page.tsx` |
| Eval (CI-gate pattern) | Regression test set that runs the same research + advisor pipeline used in production, asserting on tool selection, recommendation, dealScore bounds, narrative markers, and negative cases. Exit code 0 on pass, 1 on fail — wire to GitHub Actions to gate PRs. | `evals/run.ts`, `evals/test-cases.json` |

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

The eval runs three test cases through the same research + advisor pipeline used in production. For each case it asserts on:

- **Tool selection** — which tools the agent autonomously decided to call (catches prompt regressions that break the auto-chain to `pull_comps`)
- **Recommendation** — must land in the expected set
- **`dealScore`** — within the calibrated bounds for that property
- **Narrative markers** — substrings the advisor's verdict should mention
- **Negative cases** — off-topic prompts must NOT emit a verdict

Exit code is `0` on full pass, `1` on any failure. Wire to GitHub Actions to gate PRs.

## Design decisions

- **Sonnet over Opus as the advisor default.** The advisor's target is a fixed Zod schema fed pre-validated tool results — Sonnet hits the same structured-output quality at ~2-3× faster and ~1/5 the cost. Opus is overkill for this shape.
- **Two-step research → advisor** rather than a single advisor call. The research tool loop is cheap, parallelizable work; the advisor's structured output is the expensive part. Cost tiering makes both steps observable in the Gateway dashboard.
- **In-process `needsApproval` for the save** + **Workflow SDK for the post-save review.** The save approval lives inside one chat turn (sub-30s wait) — in-process pause is the right size. The post-save review may wait minutes to days — needs durable execution.
- **`prompt` (not `messages`) for `generateObject`.** Anthropic rejects ending a conversation on an assistant message, and the research loop always ends with assistant text. Feeding tool results as a single user turn sidesteps that and avoids the dangling-tool-call error when `create_deal` is paused at approval.
- **Bearer auth via explicit API key.** OIDC works as a fallback, but the explicit `AI_GATEWAY_API_KEY` makes localhost requests attribute to the project correctly (where the OIDC path is harder to wire up).
- **Structured output as the eval target.** Asserting on free-text narratives is noisy; the Zod-validated `Verdict` gives us discrete fields (`recommendation`, `dealScore`, `recommendedStrategy`) that drift cleanly catches prompt-tuning regressions.
- **No client-side Zod.** `VerdictCard` mirrors the Verdict type structurally and trusts server validation. Keeps Zod out of the client bundle.
- **Image optimization via Next.js Image.** The deal page's property hero uses `next/image` against DealWave's Supabase Storage CDN. Vercel's image service serves AVIF/WebP variants per client, sizes responsively, and lazy-loads below the fold. The page itself is ISR'd at 60s; the image transforms cache independently. Two caching layers for one page — the right split. The first deal card on `/deals` is flagged `priority` so it isn't lazy-loaded — that's the LCP element above the fold; lazy-loading the LCP image measurably hurts the metric.
- **Sandbox over running Python in the agent's process.** `run_what_if` could have been pure TypeScript Monte Carlo math — but the threat model is that the transform expression is model-generated code. Without Sandbox, `eval(expr)` would have full `process` + `require` access, so a prompt-injected transform could exfiltrate env vars or hit external endpoints. Sandbox isolates to a V8/python boundary with no host access. Costs ~2-3s of cold-start latency per call, accepted as the price of a defensible code-execution surface.
- **PPR for `/deals`, ISR for `/deals/[id]` — two different rendering primitives for two different data-freshness needs.** The saved-deals index is a per-account live list — staleness here means a user saves a deal in chat and doesn't see it on the index page until revalidation, which is a UX bug. PPR's static-shell + Suspense-streamed cards keeps the page chrome instant while the cards are live per request. The detail page is the opposite shape: once a deal is saved, the underlying data shifts slowly, and ISR with a 60s revalidate gives SSG speed on every cache hit while still refreshing as the agent enriches the deal. Both pages also use Suspense for sub-region streaming (PPR uses it for the card list, ISR uses it for the comps section).

## Known limitations

- **Localhost requests file under "No Project" in AI Gateway.** Project attribution works on deployed traffic. Accepted tradeoff for dev velocity.
- **Duplicate saves fail with 500.** DealWave's `unified_deals` table has `UNIQUE (account_id, lower(address))` — re-saving the same address returns a server error. Should be upserted upstream.
- **No streaming on the advisor step.** The verdict appears as one chunk after a 3-5s shimmer. `streamObject` upgrade is future work.
- **Approval pause is in-process only.** Refreshing the page during an approval-requested state drops the loop. The Workflow SDK migration path is documented in `lib/workflows/deal-analyst.ts`.

## Project structure

```
app/
  api/
    chat/route.ts             Research tool loop + advisor verdict, single SSE stream
    agent/approve/route.ts    Resumes dealReviewWorkflow via reviewHook
  deals/page.tsx              PPR saved-deals index (static shell + Suspense-streamed cards)
  deals/[id]/page.tsx         ISR deal detail (revalidate: 60) + Suspense-streamed comps
  page.tsx                    useChat shell + VerdictCard render + approval buttons
  layout.tsx, globals.css

lib/
  dealwave-client.ts          Centralized fetch, Bearer auth, 60s timeout (analyze pipeline
                              can run 30-45s cold; 60s matches chat route maxDuration)
  hooks/approval.ts           reviewHook definition (Workflow SDK)
  schemas/verdict.ts          Zod VerdictSchema (advisor target, .nullable() for OpenAI strict)
  tools/                      analyze-deal, pull-comps, create-deal (needsApproval),
                              list-deals, update-deal, run-what-if (Sandbox)
  workflows/deal-analyst.ts   dealReviewWorkflow ('use workflow' durable function)

components/
  ai-elements/                Vendored AI SDK component library (shadcn-style):
                              Conversation, Message, Tool, PromptInput, Shimmer, …
  dealwave/                   Project-specific UI:
    primitives-inspector.tsx    Right-side AI Primitives inspector (5 layered groups:
                                Engine / Runtime / Orchestration / Surface / Platform)
                                with live activation dots + active-step card glow
    verdict-card.tsx            Banner + metric tiles + risks + follow-up chips
    tool-pill.tsx               Inline tool-call pills with shared expansion panel
    approval-prompt.tsx         needsApproval "Action Required" card (amber accent)
    monte-carlo-panel.tsx       Histogram + P10/P50/P90 figures from Sandbox results
    what-if-histogram.tsx       run_what_if result renderer
    gateway-bar.tsx             Empty-state Gateway/model attribution strip
    model-selector.tsx          Research / Advisor / Backup model dropdowns
    shimmer-block.tsx           "Building verdict…" placeholder during advisor wait
    eval-badge.tsx              Eval status pill
  ui/                         shadcn primitives

evals/
  run.ts                      Regression eval (research tool selection + advisor verdict)
  test-cases.json             Cases including off-topic negative case (must NOT verdict)

scripts/
  sandbox-smoke.ts            Standalone Sandbox smoke test (spin up, install deps, exit)
```
