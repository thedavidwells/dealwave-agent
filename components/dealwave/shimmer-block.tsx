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
// WHY a sibling <style> block instead of Tailwind arbitrary values:
// matches the dot-grid pattern in this folder (single-file ownership of
// scoped CSS). The shimmer bars need a specific gradient + 1400px
// background-size to make the sweep readable; expressing that purely in
// Tailwind utilities would mean three arbitrary values per bar.

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
        <>
            {/* Scoped CSS — the .dw-shimmer-line class only exists in
                this component's render tree. The animate-shimmer Tailwind
                alias is registered in globals.css with the matching 1.8s
                timing, but we set the gradient + size here because those
                are too specific to live in the theme layer. */}
            <style>{`
                .dw-shimmer-line {
                    height: 10px;
                    border-radius: 3px;
                    background-color: rgba(255, 255, 255, 0.04);
                    background-image: linear-gradient(
                        90deg,
                        rgba(255, 255, 255, 0.04) 25%,
                        rgba(255, 255, 255, 0.1) 50%,
                        rgba(255, 255, 255, 0.04) 75%
                    );
                    background-size: 1400px 100%;
                    animation: shimmer 1.8s infinite linear;
                }
            `}</style>
            <div
                className={`animate-fade-up flex flex-col gap-[9px] ${
                    className ?? ""
                }`}
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
        </>
    );
}
