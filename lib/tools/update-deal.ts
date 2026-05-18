// lib/tools/update-deal.ts
//
// Sixth tool. Patches an existing deal record with new analysis data —
// most commonly the Monte Carlo result when the user runs run_what_if
// AFTER they've already saved the deal. Without this, MC data has no
// place to land for already-saved deals.
//
// Wraps DealWave's PATCH /api/v1/deals/{id} endpoint. The COALESCE
// upsert semantics on the DealWave side mean: fields we pass overwrite,
// fields we omit are preserved. Safe to call repeatedly.
//
// No needsApproval gate. PATCHes are non-destructive (COALESCE merge),
// the deal already exists, and the user already explicitly approved the
// original save — gating every subsequent enrichment would be friction.

import { tool } from "ai";
import { z } from "zod";
import { dealWaveFetch } from "../dealwave-client";

const updateDealInputSchema = z.object({
    deal_id: z
        .string()
        .uuid()
        .describe(
            "UUID of the deal to update. From the most recent create_deal " +
                "result's `deal.id` field, OR from a list_deals row's `id`.",
        ),
    monte_carlo: z
        .object({
            p10: z.number(),
            p50: z.number(),
            p90: z.number(),
            probability_of_loss: z.number().min(0).max(1),
            value_at_risk_95: z.number(),
            trials: z.number().int().positive(),
            interpretation: z.string().optional(),
        })
        .optional()
        .describe(
            "Monte Carlo NUMERIC SUMMARY from run_what_if. Pass the " +
                "percentile + risk fields. DO NOT pass histogram_png_base64 " +
                "— it's 30-50KB and would block the update for minutes " +
                "while the model regenerates the entire base64 string " +
                "token-by-token. The histogram is rendered inline in chat " +
                "from the original run_what_if result; the saved record " +
                "only needs the numeric summary.",
        ),
    notes: z
        .string()
        .max(10000)
        .optional()
        .describe("Updated free-form notes. Replaces existing notes."),
    pipeline_status: z
        .enum([
            "new",
            "reviewing",
            "follow_up",
            "offer_made",
            "under_contract",
            "won",
            "dead",
        ])
        .optional()
        .describe("Move the deal forward in the pipeline."),
});

export const updateDealTool = tool({
    description:
        "Updates a saved deal with new analysis data — most commonly the " +
        "Monte Carlo result after run_what_if runs on an already-saved deal. " +
        "Use this when the user has already approved a save (deal_id exists) " +
        "and now wants to attach sensitivity analysis OR update notes OR move " +
        "the pipeline status. Requires the deal_id from a previous create_deal " +
        "or list_deals result. Free (0 credits). Non-destructive merge — " +
        "fields you omit are preserved.",

    inputSchema: updateDealInputSchema,

    execute: async ({ deal_id, monte_carlo, notes, pipeline_status }) => {
        const body: Record<string, unknown> = {};
        if (notes !== undefined) body.notes = notes;
        if (pipeline_status !== undefined) body.pipeline_status = pipeline_status;

        // Monte Carlo goes into speed_check JSONB. DealWave's PATCH route
        // accepts a partial speed_check that's COALESCE-merged server-side
        // (see the upsert RPC in the dealwave repo migration
        // 20260517150000_upsert_unified_deal_full_coalesce.sql).
        if (monte_carlo !== undefined) {
            body.speed_check = {
                // Include manualComps: [] so the merge doesn't accidentally
                // nuke the field on the detail page's null-guard reader.
                manualComps: [],
                monte_carlo,
            };
        }

        if (Object.keys(body).length === 0) {
            return {
                error: true,
                message:
                    "No fields supplied to update. Pass at least one of: " +
                    "monte_carlo, notes, pipeline_status.",
            };
        }

        const result = await dealWaveFetch(`/deals/${deal_id}`, {
            method: "PATCH",
            body,
        });

        if (!result.ok) {
            return {
                error: true,
                message: result.error,
                code: result.code,
                status: result.status,
                hint:
                    result.code === "not_found"
                        ? "Deal id doesn't exist or doesn't belong to this account. Double-check the id."
                        : result.code === "validation_error"
                          ? "DealWave rejected the update. Surface the validation error."
                          : result.code === "conflict"
                            ? "Address change collided with another deal. Skip the address field."
                            : "Unknown error — apologize and tell the user the update failed.",
            };
        }

        return {
            ok: true,
            deal: result.data,
            requestId: result.requestId,
            updated_fields: Object.keys(body),
        };
    },
});
