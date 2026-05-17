// lib/schemas/verdict.ts
//
// The agent's final synthesis is a typed verdict, not free-form text.
// This drives the UI's verdict banner + metric tiles + follow-up chips
// without parsing model prose. Also serves as the eval target —
// our eval script asserts on these fields per known property.
//
// Schema is SFR-investor-focused: surfaces the metrics DealWave's
// actual paying customers underwrite by (ARV, MAO, repairs, spread,
// equity position) — not multi-family commercial signals (cap rate,
// CoC, DSCR).

import { z } from "zod";

// One metric tile. Each tile is an SFR-relevant number with a health
// judgment so the UI can pick the tile color (green / white / red).
const MetricTileSchema = z.object({
    label: z
        .string()
        .describe("Display label, e.g. 'ARV', 'MAO', 'Repairs', 'Rent Est.'"),

    value: z.number(),

    // Optional confidence range — only set for ARV today, where
    // DealWave returns arvLow / arvHigh. Lets the UI show
    // "$396K · $446K–$628K".
    rangeLow: z.number().optional(),
    rangeHigh: z.number().optional(),

    format: z
        .enum([
            "currency", // $396,237
            "currency-monthly", // $2,414/mo
            "currency-thousands", // $396K
            "percent", // 80%
            "count", // 0 flags
            "score", // 96/100
        ])
        .describe("How the UI formats the value."),

    health: z
        .enum(["strong", "neutral", "concern"])
        .describe(
            "strong = green tile (above target / healthy); " +
                "concern = red tile (problem signal); " +
                "neutral = white (informational, no judgment).",
        ),

    context: z
        .string()
        .max(40)
        .optional()
        .describe(
            "Short context line under the metric, e.g. 'After Repair Value'.",
        ),
});

const RiskSchema = z.object({
    severity: z.number().int().min(1).max(5),
    message: z.string(),
});

export const VerdictSchema = z.object({
    // Drives the verdict banner color.
    recommendation: z
        .enum(["strong-deal", "good-deal", "investigate", "pass"])
        .describe(
            "strong-deal = green banner; good-deal = green-lite; " +
                "investigate = amber (caveats apply); pass = red.",
        ),

    // The investment strategy the agent recommends for THIS deal.
    // Drives which metric tiles get prioritized.
    recommendedStrategy: z
        .enum([
            "wholesale",
            "flip",
            "buy-and-hold",
            "brrrr",
            "creative-finance",
            "pass",
        ])
        .describe(
            "Pick the strategy that maximizes this deal's economics. " +
                "Use 'pass' only if no strategy makes sense.",
        ),

    // Headline shown next to the recommendation pill.
    // Examples: "Strong wholesale deal — $134K spread"
    //           "Solid flip candidate — $119K projected profit"
    headline: z.string().max(100),

    // Deal score + grade from analyze_deal.
    dealScore: z.number().int().min(0).max(100),
    dealGrade: z.enum(["A", "B", "C", "D", "F"]),

    // Metric tiles — 4 to 6 tiles relevant to the recommended strategy.
    // Agent picks the most important tiles for THIS deal under THIS strategy.
    //
    // Examples by strategy:
    //   wholesale → ARV, MAO, Spread, Repairs
    //   flip      → ARV, Repairs, Est. Profit, Repair-to-ARV ratio
    //   buy-and-hold → ARV, Rent Est., Equity Position, Net Equity
    //   brrrr     → ARV, Repairs, Refinance proceeds, Cash left in deal
    metrics: z.array(MetricTileSchema).min(4).max(6),

    // Plain-English summary. Cite specific numbers from tool results.
    // The UI applies inline highlighting (numbers green, risk keywords red).
    narrative: z
        .string()
        .describe(
            "Use real numbers from analyze_deal / pull_comps results. " +
                "Never invent figures. State recommended offer price explicitly " +
                "(e.g. 'Recommend offering $213K').",
        ),

    // Severity-4+ risk flags surface as warnings.
    risks: z.array(RiskSchema).default([]),

    // Categorical data confidence: derived from analyze_deal's confidenceScore.
    // <60 = low, 60-80 = medium, >80 = high.
    dataConfidence: z
        .enum(["high", "medium", "low"])
        .describe(
            "Map analyze_deal's confidenceScore: >80=high, 60-80=medium, <60=low.",
        ),

    // Contextual follow-up chips below the message.
    // Tailor to the strategy + verdict.
    //
    // max(80) per chip: long enough for context-specific suggestions
    // ("Save to pipeline if ARV confirmed above $400K") but still short
    // enough to render as pill buttons without dominating the layout.
    // Earlier max(40) was too tight — rejected useful suggestions like
    // "Inspect for deferred maintenance (1959 build)".
    followUps: z
        .array(z.string().max(80))
        .min(2)
        .max(4)
        .describe(
            "Short next-action prompts (ideally ≤ 50 chars each). " +
                "Examples: 'Run at 7% vacancy', 'Show all 12 comps', " +
                "'Save to pipeline'. Tailor to the recommendation — " +
                "surface 'Save to pipeline' first for strong-deal verdicts.",
        ),

    // True for strong-deal / good-deal where saving is a natural next step.
    shouldOfferSave: z.boolean(),
});

export type Verdict = z.infer<typeof VerdictSchema>;
