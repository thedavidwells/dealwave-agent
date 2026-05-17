"use client";

// components/dealwave/dot-grid.tsx
//
// Animated dot-grid background for the empty-state hero. Renders three
// stacked layers inside a single absolutely-positioned div:
//   1. A static white-dot grid (the base layer, via background-image)
//   2. A blue-dot pseudo-layer pulsing on the gridWave keyframe (::before)
//   3. A second blue-dot pseudo-layer with a 1.5s stagger (::after)
//
// The whole stack is masked top-to-bottom so the grid fades to transparent
// before the chat content begins — the visual is meant to read as "signal
// rising into focus", not a literal grid overlay.
//
// WHY a <style> tag inside the component instead of app/globals.css:
// Tailwind v4 can't target ::before / ::after directly with utility
// classes, and we want the dot-grid CSS to live next to the component that
// owns it (single-file ownership) rather than scatter pseudo-element rules
// into the global stylesheet. The rules below are scoped via the unique
// .dw-dot-grid class so there's no global collision risk.

export default function DotGrid() {
    return (
        <>
            {/* WHY a sibling <style> rather than styled-jsx: the project
                uses plain Tailwind + globals.css, so we keep the dependency
                surface flat. A single <style> child with a scoped class is
                inert in SSR and applies once on hydration. */}
            <style>{`
                .dw-dot-grid {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 50vh;
                    pointer-events: none;
                    z-index: 0;
                    background-image: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0.8px, transparent 0.8px);
                    background-size: 20px 20px;
                    -webkit-mask-image: linear-gradient(to bottom, black 0%, black 30%, transparent 100%);
                    mask-image: linear-gradient(to bottom, black 0%, black 30%, transparent 100%);
                }
                .dw-dot-grid::before,
                .dw-dot-grid::after {
                    content: "";
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    animation: gridWave 3s ease-in-out infinite;
                }
                .dw-dot-grid::before {
                    background-image: radial-gradient(circle, rgba(96, 165, 250, 0.35) 0.8px, transparent 0.8px);
                    background-size: 20px 20px;
                    background-position: 0 0;
                    animation-delay: 0s;
                }
                .dw-dot-grid::after {
                    background-image: radial-gradient(circle, rgba(96, 165, 250, 0.2) 0.8px, transparent 0.8px);
                    background-size: 20px 20px;
                    background-position: 10px 10px;
                    animation-delay: 1.5s;
                }
            `}</style>
            <div className="dw-dot-grid" aria-hidden="true" />
        </>
    );
}
