// lib/tools/create-deal.ts
//
// Third tool. Persists an analyzed property to the investor's DealWave pipeline.
// Wraps DealWave's POST /api/v1/deals endpoint.
//
// Key difference from analyze_deal / pull_comps: this tool is gated by
// needsApproval: true. The AI SDK pauses the loop at this tool's invocation
// and surfaces an approval-requested message part to the UI. The execute
// function only fires AFTER the user (or programmatic caller) responds via
// addToolApprovalResponse.
//
// This is the human-in-the-loop primitive — never persist a deal without
// explicit user consent. Workflow SDK will make this pause durable
// (i.e. the workflow survives a serverless restart while waiting for the user
// to click). Today the pause is in-process; refreshing the page loses state.
//
// Costs 0 credits — pure DB insert, no external API calls.
// On success DealWave emits a `deal.saved` webhook with action: 'created'.

import { tool } from "ai";
import { z } from "zod";
import { start } from "workflow/api";
import { dealWaveFetch } from "../dealwave-client";
import { dealReviewWorkflow } from "@/lib/workflows/deal-analyst";

// Minimal surface for the agent. DealCreateInputSchema in DealWave supports
// many more fields (status, pipeline_status, deal_tags, follow_up_at, etc.),
// but for the agent we want a small surface the model can plausibly fill out.
// The user can edit non-essential fields in the DealWave UI after the save.
const createDealInputSchema = z.object({
    address: z
        .string()
        .min(5)
        .max(500)
        .describe(
            "Property address. Use the same address that was analyzed so " +
                "DealWave can link the analysis to the deal record.",
        ),
    name: z
        .string()
        .max(200)
        .optional()
        .describe(
            "Optional friendly name. If omitted DealWave uses the address. " +
                'Example: "Boise 4plex deal" or "Burntwood Court flip".',
        ),
    notes: z
        .string()
        .max(10000)
        .optional()
        .describe(
            "Optional notes summarizing the agent's recommendation and reasoning. " +
                "Include the deal score, recommended strategy, and any severity-4+ " +
                "risks so the user has context when they revisit the deal later.",
        ),
    investment_strategy: z
        .enum([
            "wholesale",
            "flip",
            "buy_and_hold",
            "brrrr",
            "creative_finance",
        ])
        .optional()
        .describe(
            "Recommended strategy from the analysis. Match this to the " +
                "verdict's recommendedStrategy field.",
        ),
});

export const createDealTool = tool({
    description:
        "Saves an analyzed property to the user's DealWave deal pipeline. " +
        "Use this when the user explicitly asks to save/persist a deal, OR " +
        "after a strong-deal / good-deal recommendation when offering 'Save to " +
        "pipeline?' as a follow-up. Free (0 credits) — pure DB insert. " +
        "REQUIRES USER APPROVAL — the loop will pause before this tool runs.",

    inputSchema: createDealInputSchema,

    // The critical line. needsApproval: true tells the AI SDK to:
    //   1. Stream a tool-call part with state 'approval-requested' to the UI
    //   2. PAUSE the agent loop in-process
    //   3. Wait for the client to call addToolApprovalResponse(toolCallId, ...)
    //   4. Only then call execute() with the validated input
    needsApproval: true,

    execute: async ({ address, name, notes, investment_strategy }) => {
        // Build the request body. Only include optional fields if set —
        // mirrors how dealwave-client handles undefined fields elsewhere.
        const body: Record<string, unknown> = { address };
        if (name) body.name = name;
        if (notes) body.notes = notes;
        if (investment_strategy) body.investment_strategy = investment_strategy;

        const result = await dealWaveFetch("/deals", {
            method: "POST",
            body,
        });

        if (!result.ok) {
            return {
                error: true,
                message: result.error,
                code: result.code,
                status: result.status,
                hint:
                    result.code === "rate_limit_exceeded"
                        ? "Rate limited — wait a few seconds and retry."
                        : result.code === "validation_error"
                          ? "DealWave rejected the deal data. Surface the validation error to the user."
                          : "Unknown error — apologize and tell the user the save failed.",
            };
        }

        // Kick off the durable post-save review workflow.
        //
        // This is the Workflow SDK integration point. The 'use workflow'
        // directive inside dealReviewWorkflow makes its execution state
        // durable — the workflow pauses on a reviewHook waiting for the
        // user to mark this deal as reviewed (or skipped) in their
        // pipeline. That wait could be 5 minutes or 5 days; the workflow
        // survives serverless restarts, deploys, and tab refreshes.
        //
        // Fire-and-forget (void) — we don't await the workflow because
        // it pauses indefinitely on the hook. The tool returns the saved
        // deal to the model immediately so the chat can complete.
        // The workflow continues in the background until /api/agent/approve
        // resumes it.
        const dealId = (result.data as { id?: string })?.id;
        if (dealId) {
            // start() from workflow/api kicks off a workflow instance
            // through the durable execution runtime. Calling the workflow
            // function directly throws — workflows aren't regular async
            // functions; they have to be created via start().
            await start(dealReviewWorkflow, [dealId]);
        }

        // Success — return the created deal so the model can confirm to the user
        // (e.g. "Saved as Deal #abc123 — view it at dealwave.io/deals/abc123").
        return {
            ok: true,
            deal: result.data,
            requestId: result.requestId,
        };
    },
});
