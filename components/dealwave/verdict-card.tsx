"use client";

// components/dealwave/verdict-card.tsx
//
// Renders the typed Verdict object emitted by the advisor step
// (see app/api/chat/route.ts). Composes:
//   - Verdict banner (recommendation pill + headline + dealScore)
//   - Metric tile strip (4-6 horizontal tiles with health colors)
//   - Risk warnings (severity 4+ inline alerts)
//   - Follow-up suggestion chips (clickable, fire sendMessage)
//
// We mirror the Verdict shape locally rather than importing the Zod schema
// directly, so the client bundle doesn't pull in Zod (already in the server
// route handler). Schema lives in lib/schemas/verdict.ts — keep in sync.

import { AlertTriangleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Recommendation = "strong-deal" | "good-deal" | "investigate" | "pass";
type Strategy =
    | "wholesale"
    | "flip"
    | "buy-and-hold"
    | "brrrr"
    | "creative-finance"
    | "pass";
type Health = "strong" | "neutral" | "concern";
type MetricFormat =
    | "currency"
    | "currency-monthly"
    | "currency-thousands"
    | "percent"
    | "count"
    | "score";

interface MetricTileData {
    label: string;
    value: number;
    rangeLow?: number;
    rangeHigh?: number;
    format: MetricFormat;
    health: Health;
    context?: string;
}

interface RiskData {
    severity: number;
    message: string;
}

export interface Verdict {
    recommendation: Recommendation;
    recommendedStrategy: Strategy;
    headline: string;
    dealScore: number;
    dealGrade: "A" | "B" | "C" | "D" | "F";
    metrics: MetricTileData[];
    narrative: string;
    risks: RiskData[];
    dataConfidence: "high" | "medium" | "low";
    followUps: string[];
    shouldOfferSave: boolean;
}

// Banner color logic. Tailwind dark/light variants so this looks
// right in both themes without a separate dark.
const RECOMMENDATION_STYLES: Record<Recommendation, string> = {
    "strong-deal":
        "border-green-500/40 bg-green-500/5 text-green-700 dark:text-green-400",
    "good-deal":
        "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
    investigate:
        "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    pass: "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400",
};

const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
    "strong-deal": "Strong Buy",
    "good-deal": "Good Deal",
    investigate: "Investigate",
    pass: "Pass",
};

// Tile color by health. "strong" = green (above target), "concern" = red
// (below / problem signal), "neutral" = default text (informational).
const HEALTH_COLORS: Record<Health, string> = {
    strong: "text-green-600 dark:text-green-400",
    neutral: "text-foreground",
    concern: "text-red-600 dark:text-red-400",
};

// Format a numeric value based on the tile's format field.
// Keeps display consistent across tiles and locale-aware.
function formatValue(value: number, format: MetricFormat): string {
    switch (format) {
        case "currency":
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
            }).format(value);
        case "currency-monthly":
            return (
                new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                }).format(value) + "/mo"
            );
        case "currency-thousands":
            return "$" + Math.round(value / 1000) + "K";
        case "percent":
            return new Intl.NumberFormat("en-US", {
                style: "percent",
                maximumFractionDigits: 1,
            }).format(value);
        case "count":
            return value.toString();
        case "score":
            return value + "/100";
        default:
            return value.toString();
    }
}

export function VerdictCard({
    verdict,
    onFollowUp,
}: {
    verdict: Verdict;
    // Callback fired when a follow-up suggestion chip is clicked.
    // Page.tsx passes sendMessage so the chip text becomes a new user turn.
    onFollowUp?: (prompt: string) => void;
}) {
    const severeRisks = verdict.risks.filter((r) => r.severity >= 4);

    return (
        <div className="my-3 space-y-3">
            {/* Verdict banner — recommendation pill + strategy + headline + score */}
            <Card
                className={cn(
                    "border p-4",
                    RECOMMENDATION_STYLES[verdict.recommendation],
                )}
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge
                                variant="outline"
                                className="text-xs font-medium uppercase tracking-wide"
                            >
                                {RECOMMENDATION_LABELS[verdict.recommendation]}
                            </Badge>
                            <Badge
                                variant="secondary"
                                className="text-xs capitalize"
                            >
                                {verdict.recommendedStrategy.replace(/-/g, " ")}
                            </Badge>
                            <Badge
                                variant="outline"
                                className="text-xs"
                                title={`Data confidence: ${verdict.dataConfidence}`}
                            >
                                Grade {verdict.dealGrade}
                            </Badge>
                        </div>
                        <h3 className="text-lg font-semibold leading-tight">
                            {verdict.headline}
                        </h3>
                    </div>
                    <div className="shrink-0 text-right">
                        <div className="text-3xl font-bold leading-none">
                            {verdict.dealScore}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                            / 100
                        </div>
                    </div>
                </div>
            </Card>

            {/* Metric tile strip — agent picks 4-6 tiles relevant to strategy.
                Responsive grid: 2 columns on mobile, up to 5 on desktop. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {verdict.metrics.map((tile, i) => (
                    <Card key={i} className="p-3">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {tile.label}
                        </div>
                        <div
                            className={cn(
                                "mt-1 text-lg font-bold tabular-nums",
                                HEALTH_COLORS[tile.health],
                            )}
                        >
                            {formatValue(tile.value, tile.format)}
                        </div>
                        {tile.rangeLow !== undefined &&
                            tile.rangeHigh !== undefined && (
                                <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                                    {formatValue(
                                        tile.rangeLow,
                                        "currency-thousands",
                                    )}
                                    –
                                    {formatValue(
                                        tile.rangeHigh,
                                        "currency-thousands",
                                    )}
                                </div>
                            )}
                        {tile.context && (
                            <div className="mt-1 text-[10px] text-muted-foreground">
                                {tile.context}
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            {/* Severity 4+ risk warnings — amber inline alerts.
                We only surface high-severity risks here; lower-severity flags
                are folded into the narrative paragraph above. */}
            {severeRisks.length > 0 && (
                <div className="space-y-1">
                    {severeRisks.map((risk, i) => (
                        <div
                            key={i}
                            className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm text-amber-700 dark:text-amber-400"
                        >
                            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                            <div>{risk.message}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Follow-up suggestion chips — model-emitted next actions.
                Click fires sendMessage via the onFollowUp callback so each chip
                becomes a real conversation turn (not a fake UI shortcut). */}
            {verdict.followUps.length > 0 && onFollowUp && (
                <div className="flex flex-wrap gap-2 pt-1">
                    {verdict.followUps.map((prompt, i) => (
                        <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            className="rounded-full text-xs"
                            onClick={() => onFollowUp(prompt)}
                        >
                            {prompt}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}
