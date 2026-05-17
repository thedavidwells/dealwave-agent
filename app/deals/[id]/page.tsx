// app/deals/[id]/page.tsx
//
// Deal detail page — the destination of every "View this deal →" link
// emitted by the agent (create_deal success + saved-deal table listings).
// Server component so we get ISR for free; deals don't change often once
// saved, and a 60s revalidation keeps the render fresh enough for the
// "I just clicked through from chat" case without hammering the API on
// every navigation.
//
// Rendering only — no edit/delete actions yet. The agent is still the
// primary mutation surface (research + advisor pipeline); this page is
// the "look at what I saved" view that closes the loop.

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { dealWaveFetch } from "@/lib/dealwave-client";

// ISR — rebuild this page in the background at most once per 60 seconds.
// Saved deals are mostly read-mostly objects (pipeline_status nudges
// happen rarely), so a minute of staleness is well inside what feels
// "live" to a user clicking through from a chat link.
export const revalidate = 60;

// Local, deliberately-loose shape. The DealWave API is loosely typed at
// the edge and we don't want this page to break the moment a new field
// appears server-side. Only `id` and `address` are required for the
// page to render at all — every other tile is conditional.
interface DealRecord {
    id: string;
    address: string;
    name?: string | null;
    notes?: string | null;
    deal_score?: number | null;
    deal_grade?: "A" | "B" | "C" | "D" | "F" | null;
    investment_strategy?:
        | "wholesale"
        | "flip"
        | "buy_and_hold"
        | "brrrr"
        | "creative_finance"
        | null;
    pipeline_status?: string | null;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    // Public Supabase Storage URL — populated as a side-effect of the
    // analyze pipeline. Older deals (saved before the pipeline started
    // capturing photos) or in-flight saves will have this as null; the
    // page renders without the hero in that case rather than showing a
    // broken or placeholder image.
    property_image_url?: string | null;
}

// Human-readable strategy label. The API stores snake_case enums
// (`buy_and_hold`); the UI wants Title Case with spaces. Kept local
// because this transform is only meaningful in the rendering layer —
// upstream tools should keep working with the enum value.
function formatStrategy(strategy: string): string {
    return strategy
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

// Date formatter shared across the footer row. Using `medium` keeps the
// output unambiguous ("May 17, 2026") without dragging in the time, which
// would just be noise for a saved-deal record.
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    // Guard against malformed timestamps coming back from the API —
    // better to omit the footer field than render "Invalid Date".
    if (Number.isNaN(date.getTime())) return null;
    return DATE_FORMATTER.format(date);
}

// Tile color logic for the deal grade. Mirrors the health-color
// convention in the advisor's VerdictCard so the visual language stays
// consistent between the in-chat verdict and the saved-deal page.
const GRADE_STYLES: Record<NonNullable<DealRecord["deal_grade"]>, string> = {
    A: "bg-green-500/10 text-green-700 border-green-500/30",
    B: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    C: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    D: "bg-orange-500/10 text-orange-700 border-orange-500/30",
    F: "bg-red-500/10 text-red-700 border-red-500/30",
};

// Next 16 hands route params as a Promise. The async-params change was
// the main breaking shift for App Router in this version — destructuring
// the un-awaited object is now a type error and a runtime warning.
export default async function DealDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    // Fetch the deal. The client throws at import time if env is missing,
    // so we don't need a try/catch around the call itself — a thrown
    // error here would be a real bug, not a missing-config foot-gun.
    const result = await dealWaveFetch<DealRecord>(`/deals/${id}`);

    // 404 covers both "not found" and any other API error — we don't want
    // to leak status codes or error bodies to the user. The agent's link
    // is the only sanctioned entrypoint, and if the deal isn't fetchable
    // there's nothing useful to show.
    if (!result.ok) {
        notFound();
    }

    const deal = result.data;
    const createdAt = formatDate(deal.created_at);
    const updatedAt = formatDate(deal.updated_at);

    return (
        <div className="flex min-h-screen flex-col bg-background">
            {/* Header — mirrors the agent page so navigating between the
                chat and the deal detail feels like one product, not two.
                Sticky border-b matches the analyst page's chrome. The
                back-link is right-aligned so the visual weight balances
                across the header row. */}
            <header className="sticky top-0 z-10 border-b bg-background px-6 py-4">
                <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        {/* DW square badge — solid primary tile with the
                            "DW" mark. Compact enough to sit inline with
                            the wordmark without dominating the header. */}
                        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold tracking-tight text-primary-foreground">
                            DW
                        </div>
                        <h1 className="text-base font-semibold tracking-tight">
                            DealWave Deal Analyst
                        </h1>
                    </div>
                    <Link
                        href="/"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                        ← Back to analyst
                    </Link>
                </div>
            </header>

            {/* Main column — same max-w-3xl as the analyst page so the
                eye doesn't have to re-anchor when navigating between
                chat and detail. */}
            <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
                {/* Property image hero — only when DealWave's analyze
                    pipeline captured a photo. Lives ABOVE the title so
                    the page reads "this is the property" before "here
                    are its numbers".
                    Implementation notes:
                    - aspect-video locks the wrapper to 16:9 so the
                      layout doesn't shift while the optimized image
                      loads (avoids a CLS hit on Lighthouse).
                    - fill + sizes lets next/image pick the right
                      width-variant for the viewport rather than always
                      serving the largest variant.
                    - priority because this is above-the-fold on the
                      page and we want the LCP candidate eager-loaded
                      via <link rel="preload">.
                    - rounded-lg + overflow-hidden so the image clips to
                      the 8px corners shared by other dark-theme cards. */}
                {deal.property_image_url && (
                    <div className="relative mb-6 aspect-video w-full overflow-hidden rounded-lg border border-[var(--dw-border)] bg-[var(--dw-surface-1)]">
                        <Image
                            src={deal.property_image_url}
                            alt={`Photo of ${deal.address}`}
                            fill
                            priority
                            sizes="(max-width: 768px) 100vw, 720px"
                            className="object-cover"
                        />
                    </div>
                )}

                {/* Title block. Address is the canonical identifier in
                    the user's head ("the Burntwood Ct deal"), so it gets
                    h1 weight; the optional `name` is a user-supplied
                    alias and sits underneath as a subtitle. */}
                <div className="mb-6">
                    <h1 className="text-2xl font-semibold leading-tight tracking-tight">
                        {deal.address}
                    </h1>
                    {deal.name && (
                        <p className="mt-1 text-sm text-muted-foreground">
                            {deal.name}
                        </p>
                    )}
                </div>

                {/* Metric strip — only the fields that exist render as
                    tiles. We skip nulls rather than showing "N/A" so the
                    page never looks half-empty for a freshly-saved deal
                    that hasn't been graded yet. Layout flexes so it
                    looks balanced with 1, 3, or 5 tiles. */}
                <div className="mb-6 flex flex-wrap gap-2">
                    {typeof deal.deal_score === "number" && (
                        <Card size="sm" className="px-3 py-2">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Deal Score
                            </div>
                            <div className="mt-0.5 text-lg font-bold tabular-nums">
                                {deal.deal_score}
                                <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                                    /100
                                </span>
                            </div>
                        </Card>
                    )}

                    {deal.deal_grade && (
                        <Card size="sm" className="px-3 py-2">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Grade
                            </div>
                            <div
                                className={`mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 text-sm font-bold ${GRADE_STYLES[deal.deal_grade]}`}
                            >
                                {deal.deal_grade}
                            </div>
                        </Card>
                    )}

                    {deal.investment_strategy && (
                        <Card size="sm" className="px-3 py-2">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Strategy
                            </div>
                            <div className="mt-1">
                                <Badge variant="secondary">
                                    {formatStrategy(deal.investment_strategy)}
                                </Badge>
                            </div>
                        </Card>
                    )}

                    {deal.pipeline_status && (
                        <Card size="sm" className="px-3 py-2">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Pipeline
                            </div>
                            <div className="mt-1">
                                <Badge variant="outline">
                                    {deal.pipeline_status}
                                </Badge>
                            </div>
                        </Card>
                    )}

                    {deal.status && (
                        <Card size="sm" className="px-3 py-2">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Status
                            </div>
                            <div className="mt-1">
                                <Badge variant="outline">{deal.status}</Badge>
                            </div>
                        </Card>
                    )}
                </div>

                {/* Notes — free-form text from the create_deal flow.
                    `whitespace-pre-wrap` preserves the line breaks the
                    agent or user typed in; without it, multi-paragraph
                    notes collapse to a single run-on line. */}
                {deal.notes && (
                    <Card className="mb-6">
                        <CardContent>
                            <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Notes
                            </div>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                                {deal.notes}
                            </p>
                        </CardContent>
                    </Card>
                )}

                {/* Footer row — created/updated timestamps. Only renders
                    if at least one date is available; an empty timestamp
                    row would just be visual noise. */}
                {(createdAt || updatedAt) && (
                    <div className="mt-8 flex flex-wrap gap-x-6 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
                        {createdAt && <span>Created {createdAt}</span>}
                        {updatedAt && <span>Updated {updatedAt}</span>}
                    </div>
                )}
            </main>
        </div>
    );
}
