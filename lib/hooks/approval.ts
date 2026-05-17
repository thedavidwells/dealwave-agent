// lib/hooks/approval.ts
//
// Vercel Workflow SDK hook definition for the deal-review pattern.
//
// A `defineHook<T>()` call creates a TYPED pause-point that any
// workflow function can wait on via `hook.create({ token })`. The
// workflow blocks at the for-await loop until SOMEONE calls
// `hook.resume(token, data)` from anywhere — an API route, a webhook,
// a scheduled task — passing the data shape declared in the hook's
// type parameter.
//
// The token is the correlation ID: the workflow waits on a specific
// token; the resume call targets that same token. This is how we
// link a UI button click (or a webhook event) back to the workflow
// that's waiting for it.
//
// For DealWave Agent: after a user saves a deal, dealReviewWorkflow
// pauses on this hook until they mark the deal "reviewed" in their
// pipeline. The pause survives serverless restarts, deploys, and
// browser refreshes — that's the durability guarantee Workflow SDK
// provides over an in-process pause.

import { defineHook } from "workflow";

export const reviewHook = defineHook<{
    decision: "reviewed" | "skipped";
    notes?: string;
}>();
