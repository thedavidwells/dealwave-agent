"use client";

// components/dealwave/analysis-accordion.tsx
//
// Collapsible "AI Analysis" panel on the deal detail page. Default
// collapsed so the page doesn't open with a wall of text. Click the
// header to expand; arrow flips ▼ ↔ ▲.

import { useState } from "react";

const C = {
    sf: "#111111",
    bd: "rgba(255,255,255,0.08)",
    text: "#fafafa",
    sub: "rgba(255,255,255,0.55)",
    dim: "rgba(255,255,255,0.28)",
    font: '"Geist", -apple-system, BlinkMacSystemFont, sans-serif',
};

export function AnalysisAccordion({ notes }: { notes: string }) {
    const [open, setOpen] = useState(false);

    return (
        <div
            style={{
                background: C.sf,
                border: `1px solid ${C.bd}`,
                borderRadius: 7,
                marginBottom: 16,
                overflow: "hidden",
            }}
        >
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                style={{
                    width: "100%",
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    <span style={{ fontSize: 14 }}>🤖</span>
                    <span
                        style={{
                            fontFamily: C.font,
                            fontSize: 14,
                            fontWeight: 600,
                            color: C.text,
                        }}
                    >
                        AI Analysis
                    </span>
                </div>
                <span
                    style={{
                        fontFamily: C.font,
                        fontSize: 12,
                        color: C.dim,
                    }}
                >
                    {open ? "▲" : "▼"}
                </span>
            </button>
            {open && (
                <div
                    style={{
                        padding: "0 16px 16px",
                        borderTop: `1px solid ${C.bd}`,
                    }}
                >
                    <div
                        style={{
                            fontFamily: C.font,
                            fontSize: 13,
                            color: C.sub,
                            lineHeight: 1.7,
                            whiteSpace: "pre-wrap",
                            marginTop: 12,
                        }}
                    >
                        {notes}
                    </div>
                </div>
            )}
        </div>
    );
}
