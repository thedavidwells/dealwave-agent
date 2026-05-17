"use client";

// components/dealwave/approval-prompt.tsx
//
// "Action Required" block shown when create_deal is in `approval-requested`
// state. This is the human-in-the-loop gate — the model has staked a claim
// (a deal it wants to write), and we surface explicit user consent before
// the tool's execute() ever fires.
//
// WHY a dedicated component: the inline approval row in app/page.tsx was
// intentionally minimal scaffolding. This file is the designed treatment —
// amber accent (matches the `investigate` recommendation lane), 3px left
// border as the signature visual cue, and a primary/secondary button pair
// where the destructive-ish action ("Save Deal") wears the amber fill so
// the user reads the gravity of writing to their pipeline.
//
// Visual tokens come from globals.css (--dw-amber, --dw-border-md, etc.)
// so the component stays theme-coherent if the palette ever shifts.

import { useState } from "react";

type ApprovalPromptProps = {
    // Address pulled from `part.input.address` by the caller. We render it
    // inline so the user sees exactly which property they're committing —
    // never trust the user to remember which tool call they're approving.
    address: string;
    onApprove: () => void;
    onSkip: () => void;
    // Optional external disable signal. The parent may already track a
    // "responded" flag (e.g. from the tool part's state machine); when
    // true, both buttons go to 50% opacity and stop responding. If the
    // parent doesn't pass this, the component still self-disables on the
    // first click via internal `pressed` state — that way we can't fire
    // onApprove/onSkip twice from a double-click race.
    disabled?: boolean;
};

export function ApprovalPrompt({
    address,
    onApprove,
    onSkip,
    disabled = false,
}: ApprovalPromptProps) {
    // Local pressed state — independent of the `disabled` prop so the
    // component is safe to use without external tracking. Once the user
    // commits to either action, both buttons lock until the parent
    // unmounts us (which it will, since the tool part transitions out of
    // `approval-requested`).
    const [pressed, setPressed] = useState(false);
    const isLocked = disabled || pressed;

    const handleApprove = () => {
        if (isLocked) return;
        setPressed(true);
        onApprove();
    };

    const handleSkip = () => {
        if (isLocked) return;
        setPressed(true);
        onSkip();
    };

    return (
        <div
            // Inline style for the 3px amber left border because Tailwind
            // arbitrary `border-l-[3px]` + `border-l-[var(--dw-amber)]`
            // sometimes loses specificity against the 1px ring border above.
            // Setting it inline guarantees the signature accent renders.
            style={{
                backgroundColor: "rgba(245,158,11,0.04)",
                border: "1px solid rgba(245,158,11,0.28)",
                borderLeft: "3px solid var(--dw-amber)",
                borderRadius: 7,
                padding: "14px 18px",
                maxWidth: 540,
            }}
            className="animate-fade-up flex flex-col gap-3"
        >
            {/* Header row — small uppercase label with the warning glyph.
                The amber color ties this to the `investigate` lane in
                VerdictCard so users build a consistent visual vocabulary:
                amber = "stop and think". */}
            <div className="flex items-center gap-[7px]">
                <span
                    aria-hidden="true"
                    style={{ fontSize: 13, color: "var(--dw-amber)" }}
                >
                    ⚠
                </span>
                <span
                    style={{
                        fontSize: 11,
                        letterSpacing: "0.7em",
                        fontWeight: 500,
                        color: "var(--dw-amber)",
                        textTransform: "uppercase",
                    }}
                >
                    Action Required
                </span>
            </div>

            {/* Body copy — address bolded into full white so the user's eye
                lands on the property identifier first. Everything else is
                80% white so it reads as supporting context. */}
            <p
                className="font-sans text-[rgba(255,255,255,0.8)]"
                style={{ fontSize: 14, lineHeight: 1.5 }}
            >
                Save{" "}
                <strong
                    style={{ color: "var(--dw-text)", fontWeight: 500 }}
                >
                    &ldquo;{address}&rdquo;
                </strong>{" "}
                to your deal pipeline? This will create a deal record with
                your analysis attached.
            </p>

            {/* Button row — primary "Save Deal" carries the amber fill
                with black text (spec is explicit; black on amber hits the
                contrast threshold and reads as "commit"). Skip is the
                quiet escape hatch. */}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={handleApprove}
                    disabled={isLocked}
                    // WHY inline styles over Tailwind here: the amber bg +
                    // black text + hover opacity combination is fiddly to
                    // express with utilities without introducing arbitrary
                    // values that don't tree-shake well. Inline keeps it
                    // legible and locally owned.
                    style={{
                        padding: "8px 18px",
                        backgroundColor: "var(--dw-amber)",
                        color: "#000",
                        borderRadius: 5,
                        fontSize: 14,
                        fontWeight: 600,
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        border: "none",
                        cursor: isLocked ? "default" : "pointer",
                        opacity: isLocked ? 0.5 : 1,
                        transition: "opacity 120ms ease",
                    }}
                    onMouseEnter={(e) => {
                        if (!isLocked) e.currentTarget.style.opacity = "0.82";
                    }}
                    onMouseLeave={(e) => {
                        if (!isLocked) e.currentTarget.style.opacity = "1";
                    }}
                >
                    Save Deal
                </button>
                <button
                    type="button"
                    onClick={handleSkip}
                    disabled={isLocked}
                    style={{
                        padding: "8px 16px",
                        backgroundColor: "transparent",
                        border: "1px solid var(--dw-border-md)",
                        color: "var(--dw-sub)",
                        borderRadius: 5,
                        fontSize: 14,
                        fontWeight: 400,
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        cursor: isLocked ? "default" : "pointer",
                        opacity: isLocked ? 0.5 : 1,
                        transition:
                            "color 120ms ease, border-color 120ms ease, opacity 120ms ease",
                    }}
                    onMouseEnter={(e) => {
                        if (isLocked) return;
                        e.currentTarget.style.borderColor =
                            "var(--dw-border-str)";
                        e.currentTarget.style.color = "var(--dw-text)";
                    }}
                    onMouseLeave={(e) => {
                        if (isLocked) return;
                        e.currentTarget.style.borderColor =
                            "var(--dw-border-md)";
                        e.currentTarget.style.color = "var(--dw-sub)";
                    }}
                >
                    Skip
                </button>
            </div>
        </div>
    );
}
