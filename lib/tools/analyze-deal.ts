// lib/tools/analyze-deal.ts
//
// First tool. Analyzes a property as an investment opportunity.
// Wraps DealWave's POST /api/v1/analyze endpoint.

import { tool } from "ai";
import { z } from "zod";
import { dealWaveFetch } from "../dealwave-client";

// Input schema mirrors DealWave's Analyze RequestSchema:
// single free-text address, 5-200 characters
// The model emits JSON matching this. SDK validated before calling execute.
const analyzeDealInputSchema = z.object({
    address: z
        .string()
        .min(5, "Address must be at least 5 characters")
        .max(200, "Address must be less than 200 characters")
        .describe(
            "Property address as free text. Can be partial — DealWave will normalize. " +
                'Examples: "123 Main St, Boise ID", "456 Oak Ave Pittsburgh"',
        ),
});

export const analyzeDealTool = tool({
    // The model reads this description to decide WHEN to call this tool.
    // Write it like docs for a junior engineer who's never seen the codebase.
    description:
        "Analyzes a real estate property as an investment opportunity. " +
        "Returns underwriting data including estimated value, cap rate, " +
        "DSCR, cash flow estimates, and a preliminary buy/pass signal. " +
        "Use this whenever the user provides a property address and wants " +
        "to evaluate it for investment. The address can be free-text — " +
        "DealWave handles normalization, geocoding, and APN resolution. " +
        "Costs 1 analysis credit per call.",

    inputSchema: analyzeDealInputSchema,

    // execute receives validated, typed input. ✅
    // Return value becomes the tool result the model sees.
    execute: async ({ address }) => {
        const result = await dealWaveFetch("/analyze", {
            method: "POST",
            body: { address },
        });

        // Important: do not throw on failure!
        // Return structured error so the model can reason about it
        // and decide whether to retry, apologize, or try a different tool.
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
                          : result.code === "plan_required"
                            ? "API requires Agentic plan. Tell the user to upgrade."
                            : result.code === "validation_error"
                              ? "The address may be malformed. Try a different format or ask the user to clarify."
                              : "Unknown error — apologize and suggest trying again.",
            };
        }

        // Success! Pass through the analysis data.
        // The model will read this and decide whether to call more tools
        // (e.g. pull_comps for validation) or synthesize a response to the user.
        return {
            ok: true,
            analysis: result.data,
            requestId: result.requestId, // Include the DealWave request ID for observability and debugging.
        };
    },
});
