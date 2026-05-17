// lib/tools/pull-comps.ts
//
// Second tool. Pulls comparable sales for an address to validate
// (or challenge) the ARV estimate from analyze_deal.
// Wraps DealWave's POST /api/v1/comps endpoint.
//
// Costs 1 analysis credit per call (same `analysis` billing bucket as analyze_deal).
// The executor cascades search radius 1mi → 3mi → 5mi for rural areas and falls
// back to V2 comps when V3 returns nothing — that logic lives in DealWave;
// we just call it.

import { tool } from "ai";
import { z } from "zod";
import { dealWaveFetch } from "../dealwave-client";

// Input schema mirrors DealWave's PullCompsInputSchema in the repo.
// Address required; redius + limit optional with defaults.
// (DealWave applies sensible defaults and cascades readius automatically.)
const pullCompsInputSchema = z.object({
    address: z
        .string()
        .min(1, "Address is required")
        .describe(
            "Property address to find comps for. Same format as analyze_deal — " +
                "free-text, DealWave normalizes downstream.",
        ),
    radius: z
        .number()
        .min(0.1, "Radius must be at least 0.1 miles")
        .max(25, "Radius must be less than 25 miles")
        .optional()
        .describe("Search radius in miles. Leave unset for the default."),
    limit: z
        .number()
        .int()
        .min(1, "Limit must be at least 1")
        .max(25, "Limit must be 25 or fewer")
        .optional()
        .describe(
            "Maximum number of comps to return (1–25). Leave unset for the default.",
        ),
});

export const pullCompsTool = tool({
    // Description tells the model WHEN this tool is appropriate.
    // Written like docs for a junior teammate; the model uses this to
    // decide whether the user's intent matches.
    description:
        "Pulls comparable sales (comps) for a property address to validate " +
        "the ARV estimate from analyze_deal. Returns nearby recent sales with " +
        "price, sqft, beds/baths, distance, and days on market. " +
        "USE THIS when analyze_deal returns: " +
        "(a) confidenceScore < 60, " +
        "(b) compCount < 3, " +
        "(c) any riskFlag with severity >= 4 mentioning valuation, ARV, or pricing. " +
        "Also use when the user explicitly asks for comps. " +
        "Costs 1 analysis credit per call.",

    inputSchema: pullCompsInputSchema,

    // execute receives validated, typed input. ✅
    // Return value becomes the tool result the model sees.
    execute: async ({ address, radius, limit }) => {
        // Only include optional fields if the model explicitly set them.
        // Passing undefined would still serialize as `null` in JSON, which
        // would fail DealWave's optional() validation in some versions.
        const body: Record<string, unknown> = { address };
        if (radius !== undefined) body.radius = radius;
        if (limit !== undefined) body.limit = limit;

        const result = await dealWaveFetch("/comps", {
            method: "POST",
            body,
        });

        // Same structured-error pattern as analyze_deal
        // The model reads 'code' + 'hint' and decides whether to retry, apologize, or give up.
        if (!result.ok) {
            return {
                error: true,
                message: result.error,
                code: result.code,
                status: result.status,
                hint:
                    result.code === "rate_limit_exceeded"
                        ? "Rate limited — wait a few seconds and retry."
                        : result.code === "quota_exceeded"
                          ? "Out of analysis credits this month. Tell the user."
                          : result.code === "validation_error"
                            ? "Address may be malformed. Ask the user to clarify."
                            : "Unknown error — apologize and suggest trying again.",
            };
        }

        // Success - pass through the comp data.
        // The model will surgace comp prices in it's synthesis to either
        // confirm or challenge the analyze_deal ARV
        return {
            ok: true,
            comps: result.data,
            requestId: result.requestId,
        };
    },
});
