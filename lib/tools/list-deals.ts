// lib/tools/list-deals.ts
//
// Fourth tool. Lists deals saved in the user's DealWave pipeline so the
// agent can answer questions like "show me my recent deals" or
// "any wholesale deals saved?" and surface them with /deals/<id> links.
// Wraps DealWave's GET /api/v1/deals endpoint.
//
// This is a research-side tool (the model calls it before the advisor
// composes its final reply). Cost is ~0 credits — it's a DB read on
// DealWave's side, not an analysis run, so the model can call it freely
// whenever the user is asking about their existing pipeline.

import { tool } from "ai";
import { z } from "zod";
import { dealWaveFetch } from "../dealwave-client";

// Input schema mirrors DealWave's DealListQuerySchema exactly. Field names
// MUST match what the API expects (snake_case on pipeline_status /
// include_archived) because dealWaveFetch passes them through as
// querystring keys verbatim.
//
// pipeline_status and stage are typed as z.string() rather than z.enum()
// on purpose: DealWave's enums are loosely typed at the edge and evolve
// independently of this repo. Mirroring them here would mean a brittle
// duplicate that drifts out of sync; instead we let the API reject any
// unknown values with a validation_error the model can react to.
const listDealsInputSchema = z.object({
    limit: z
        .number()
        .int()
        .min(1, "Limit must be at least 1")
        .max(25, "Limit must be 25 or fewer")
        .default(10)
        .describe(
            "Maximum number of deals to return (1–25). Defaults to 10 — " +
                "enough to answer 'show me my recent deals' without flooding the chat.",
        ),
    status: z
        .string()
        .optional()
        .describe(
            "Free-form status filter matching DealWave's status field " +
                '(e.g. "active", "archived"). Leave unset to include any status.',
        ),
    pipeline_status: z
        .string()
        .optional()
        .describe(
            "Pipeline status filter (DealWave enum, loosely typed here). " +
                "Set only when the user explicitly asks for a specific pipeline bucket.",
        ),
    stage: z
        .string()
        .optional()
        .describe(
            "Deal stage filter (DealWave enum, loosely typed here). " +
                "Set only when the user explicitly asks for a specific stage.",
        ),
    include_archived: z
        .boolean()
        .optional()
        .describe(
            "When true, archived deals are included in the result. " +
                "Defaults to DealWave's server-side default (archived hidden) when unset.",
        ),
});

export const listDealsTool = tool({
    // Description tells the model WHEN to call this. Scoped tightly to
    // questions about the user's saved deals / pipeline so it doesn't
    // fire unprompted during a fresh property analysis.
    description:
        "Lists deals saved in the user's DealWave pipeline. " +
        "Returns deal records with id, address, status, stage, and pipeline_status " +
        "so the advisor can surface them with clickable /deals/<id> links. " +
        "USE THIS when the user asks about their saved deals, pipeline, deal history, " +
        "or deals filtered by status / stage / strategy / area. " +
        'Examples: "show me my recent deals", "what was my last deal in Boise?", ' +
        '"any wholesale deals saved?", "what\'s in my pipeline?". ' +
        "DO NOT call this during a fresh property analysis where the user gave an address " +
        '(e.g. "analyze 123 Main St") — use analyze_deal for that instead. ' +
        "Costs ~0 credits (DB read, not an analysis run).",

    inputSchema: listDealsInputSchema,

    // execute receives validated, typed input. Zod has already applied
    // the limit default, so we never need to fall through to a client
    // default here.
    execute: async ({ limit, status, pipeline_status, stage, include_archived }) => {
        // Pass filters through as query params. dealWaveFetch drops any
        // undefined entries for us, so we can hand it the partial object
        // directly without filtering — keeps this readable.
        const result = await dealWaveFetch<{
            deals: unknown[];
            next_cursor: string | null;
            count: number;
        }>("/deals", {
            method: "GET",
            query: {
                limit,
                status,
                pipeline_status,
                stage,
                include_archived,
            },
        });

        // Same structured-error pattern as the other tools. The model
        // reads 'code' + 'hint' and decides whether to retry, ask the
        // user to clarify, or apologize.
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
                          ? "Filter parameters were invalid. Ask the user to clarify what they're looking for."
                          : "Unknown error — apologize and suggest the user try again.",
            };
        }

        // Success — pass through the DealWave fields verbatim. The advisor
        // reads addresses, IDs, statuses, etc. directly off the deal records
        // to build /deals/<id> links and summarize the pipeline. We
        // intentionally don't paginate here: returning next_cursor lets
        // the model decide whether to request more on a follow-up turn.
        return {
            ok: true,
            deals: result.data.deals,
            next_cursor: result.data.next_cursor,
            count: result.data.count,
            requestId: result.requestId,
        };
    },
});
