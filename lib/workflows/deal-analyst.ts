// lib/workflows/deal-analyst.ts
//
// Vercel Workflow SDK durable functions for DealWave Agent.
//
// The `'use workflow'` directive at the top of an async function marks
// its execution state as DURABLE: state is checkpointed between every
// async await, so the function can pause indefinitely and resume from
// the last checkpoint after:
//   - serverless function timeouts (no 10-300s ceiling)
//   - deploys / hot-reloads (new deploy preserves running workflows)
//   - browser tab closes (the workflow doesn't depend on a client)
//   - manual restarts
//
// In contrast, the AI SDK's `needsApproval: true` flag on a tool
// pauses the loop IN-PROCESS only — refreshing the page during an
// approval loses the loop state. Workflow SDK is the production-grade
// durability primitive.
//
// HOW WE USE IT TODAY:
// After create_deal successfully writes to DealWave, the route handler
// kicks off dealReviewWorkflow(dealId). The workflow pauses on
// reviewHook.create() — waiting for the user to mark the deal reviewed
// in their pipeline. That wait could be 5 minutes or 5 days; the
// workflow survives all the same.
//
// MIGRATION PATH (documented in README):
// The create_deal approval gate today uses AI SDK's in-process
// needsApproval, which is fine because the approval lives inside a
// single chat turn (sub-30-second wait). Moving the approval gate
// into a Workflow SDK flow would be appropriate for longer waits —
// e.g., a multi-party approval, async email confirmation, or
// scheduled "follow up tomorrow" reminders.

import { reviewHook } from "@/lib/hooks/approval";

/**
 * Post-save review workflow.
 *
 * Invoked after create_deal succeeds. Pauses indefinitely on the
 * review hook until the user marks the deal reviewed (or skipped).
 * Demonstrates the durability + hook-resume pattern.
 *
 * @param dealId - The DealWave deal ID returned by create_deal.
 *                 Also used as the correlation token for the review hook.
 */
export async function dealReviewWorkflow(dealId: string) {
    "use workflow";

    console.log("[workflow:dealReview] started", { dealId });

    // Pause and wait for review events. The for-await loop blocks
    // here until /api/agent/approve fires reviewHook.resume(dealId, ...).
    // State is checkpointed at this boundary — restart-safe.
    const events = reviewHook.create({ token: dealId });

    for await (const event of events) {
        if (event.decision === "reviewed") {
            console.log("[workflow:dealReview] reviewed", {
                dealId,
                notes: event.notes,
            });
            // Production extensions (not in scope for this build):
            // - Update deal record's reviewed_at timestamp via DealWave API
            // - Emit a PostHog event for funnel tracking
            // - Send a follow-up email summary
            return { ok: true, decision: "reviewed" as const, dealId };
        }

        if (event.decision === "skipped") {
            console.log("[workflow:dealReview] skipped", { dealId });
            return { ok: true, decision: "skipped" as const, dealId };
        }
    }

    // Loop exited without a decision — shouldn't happen in practice
    // since the hook stays open until resumed, but Workflow SDK
    // demands an exhaustive return.
    return { ok: false, decision: "abandoned" as const, dealId };
}
