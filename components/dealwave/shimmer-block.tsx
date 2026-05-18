"use client";

// components/dealwave/shimmer-block.tsx
//
// Streaming-pending shimmer shown in the gap between the research model
// finishing and the advisor model emitting the typed verdict. Without
// this block the input feels frozen for 3-5s; with it, the wait reads
// as intentional progress. Disappears the instant data-verdict arrives.
//
// Composition:
//   - Four horizontal shimmer bars with varied widths (88/72/94/60%) so
//     the eye reads it as "text being laid down" rather than a uniform
//     loading bar.
//   - A pulsing dot + "streaming" label below, both on the text-pulse
//     keyframe to reinforce that something is actively happening server
//     side — not a stalled request.
//
// The shimmer bar visual lives as `.dw-shimmer-line` in app/globals.css —
// a single global rule rather than a per-mount <style> tag. Inlining it
// per render mutated the CSSOM each time the block mounted during
// streaming and caused a small CLS bump; the global rule shares one
// gradient + sweep across every shimmer instance.

type ShimmerBlockProps = {
    // Override the "streaming" label. Useful for the narrow window
    // between research-done and advisor-emitting where the parent may
    // want "building verdict…" to better describe the phase.
    label?: string;
    className?: string;
};

export function ShimmerBlock({
    label = "streaming",
    className,
}: ShimmerBlockProps) {
    return (
        // .dw-shimmer-line lives in app/globals.css. We deliberately do
        // NOT inline a <style> tag here: every mount of ShimmerBlock
        // during streaming would re-emit a style node and mutate the
        // CSSOM, which can flicker layout in a way that registers as a
        // tiny CLS bump on Lighthouse. The class is a global token now.
        <div
            className={`dw-shimmer-block animate-fade-up flex flex-col gap-[9px] ${
                className ?? ""
            }`}
            // Reserve vertical space so when this block unmounts and the
            // VerdictCard takes its place, the page does NOT contract
            // first and then re-expand (that round-trip is a CLS source).
            // 86px = 4 × 10px shimmer line + 3 × 9px gap + ~17px label
            // row — within a few px of the typical VerdictCard banner.
            style={{ minHeight: 86 }}
        >
                {/* Four bars, varied widths. The widths approximate the
                    rhythm of a real paragraph (long, medium, longest,
                    short) so the loading state previews the shape of the
                    verdict narrative the user is about to see. */}
                <div
                    className="dw-shimmer-line"
                    style={{ width: "88%" }}
                    aria-hidden="true"
                />
                <div
                    className="dw-shimmer-line"
                    style={{ width: "72%" }}
                    aria-hidden="true"
                />
                <div
                    className="dw-shimmer-line"
                    style={{ width: "94%" }}
                    aria-hidden="true"
                />
                <div
                    className="dw-shimmer-line"
                    style={{ width: "60%" }}
                    aria-hidden="true"
                />

                {/* Pulsing-dot row — a quiet signal that work is still
                    happening. The 2px margin-top sits the row just under
                    the bars without competing with their rhythm. */}
                <div
                    className="flex items-center gap-[7px]"
                    style={{ marginTop: 2, paddingTop: 4 }}
                >
                    <span
                        className="animate-text-pulse"
                        style={{
                            width: 5,
                            height: 5,
                            borderRadius: "50%",
                            backgroundColor: "var(--dw-blue)",
                            display: "inline-block",
                        }}
                        aria-hidden="true"
                    />
                    <span
                        className="animate-text-pulse font-sans"
                        style={{
                            fontSize: 12,
                            color: "var(--dw-dim)",
                        }}
                    >
                        {label}
                    </span>
                </div>
        </div>
    );
}
