// components/dealwave/motion-background-utils.ts
//
// Vendored from the DealWave marketing site so the hero wave field has
// matching brand colors + per-viewport tuning. Keep aligned with the
// upstream copy unless we have a specific reason to drift.
//
// One intentional drift vs. upstream: `maxConcurrentPulses` is forced to
// 1 on every breakpoint instead of 2 on desktop. Under our chat input
// the wave field is ambient chrome, not a hero showpiece — calmer
// activity reads as "alive" without competing with the prompt.

export const MOTION_BRAND = {
    blue: "#155DFC",
    cyan: "#5AAED4",
    purple: "#8B5CF6",
    darkBg: "#0A0B14",
    textPrimary: "#F8FAFC",
    textMuted: "#94A3B8",
} as const;

export interface RgbColor {
    r: number;
    g: number;
    b: number;
}

interface MatchMediaLike {
    matchMedia?: (query: string) => Pick<MediaQueryList, "matches">;
}

export interface IntelligentWaveFieldConfig {
    spacing: number;
    maxConcurrentPulses: number;
    includeDiagonalConnections: boolean;
    mouseRadius: number;
}

export function hexToRgb(hex: string): RgbColor {
    return {
        r: Number.parseInt(hex.slice(1, 3), 16),
        g: Number.parseInt(hex.slice(3, 5), 16),
        b: Number.parseInt(hex.slice(5, 7), 16),
    };
}

export function resolveDevicePixelRatio(value?: number): number {
    const safeValue = value ?? 1;
    return Math.min(Math.max(safeValue, 1), 2);
}

export function shouldReduceMotion(source?: MatchMediaLike): boolean {
    if (!source?.matchMedia) {
        return false;
    }
    return source.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function getIntelligentWaveFieldConfig(
    width: number,
): IntelligentWaveFieldConfig {
    const isMobile = width < 640;

    return {
        spacing: isMobile ? 32 : 26,
        // Upstream was 2 on desktop. We cap at 1 to keep the field
        // visually quiet under the chat input — pulses still happen,
        // just one at a time so the eye isn't drawn away from the
        // prompt.
        maxConcurrentPulses: 1,
        includeDiagonalConnections: !isMobile,
        mouseRadius: isMobile ? 72 : 90,
    };
}
