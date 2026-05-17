"use client";

// components/dealwave/dw-logo.tsx
//
// The DealWave square brand mark. Kept as its own component so the header,
// future avatar slots, and any inline-text usage all render the exact same
// glyph — the dimensions, radius, and 700-weight "DW" lockup are part of
// the brand spec and shouldn't be re-implemented ad-hoc each place it shows
// up.

import * as React from "react";

export function DWLogo({
    size = 28,
    className,
}: {
    // Default 28×28 matches the header spec. `size` exists so we can drop
    // the mark inline with text at smaller sizes later without forking the
    // component. The internal "DW" font size scales proportionally below.
    size?: number;
    className?: string;
}) {
    // 11px text at the 28px default — design-mandated. We scale linearly
    // off the default so an 18px mark renders ~7px text rather than a
    // fixed 11px that would overflow a smaller box.
    const fontSize = (11 / 28) * size;

    return (
        <div
            className={
                // `bg-[var(--dw-text)]` resolves to #fafafa per the token
                // table — same source of truth as the rest of the UI so a
                // future theme tweak flows through here automatically.
                "inline-flex items-center justify-center rounded-[4px] bg-[var(--dw-text)] font-sans font-bold text-black " +
                (className ?? "")
            }
            // Width/height/font-size are dynamic so they have to be inline.
            // Everything else is a Tailwind utility.
            style={{
                width: size,
                height: size,
                fontSize,
                // 700 is design-mandated and is NOT the same as Tailwind's
                // `font-bold` on every font stack — Geist treats them as
                // distinct weights. Set it explicitly to be safe.
                fontWeight: 700,
                lineHeight: 1,
            }}
            aria-label="DealWave"
        >
            DW
        </div>
    );
}
