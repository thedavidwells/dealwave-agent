"use client";

// components/dealwave/intelligent-wave-field.tsx
//
// Vendored from the DealWave marketing site (dealwave/apps/web/app/
// (marketing)/_components/intelligent-wave-field.tsx) and tuned for use
// as a quiet ambient backdrop under the agent's empty-state hero —
// rather than as a full-bleed marketing showpiece.
//
// Deltas from the upstream copy (each per the HANDOFF doc's "Making it
// subtle" section):
//
//   §2  Dark-gradient overlays REMOVED — only the canvas remains. The
//       upstream forced a #0A0B14 background through four overlay divs,
//       which would re-paint our #0a0a0a app bg with a slightly bluer
//       tint and add a heavy vignette. We want the field to layer on
//       the existing app surface, not redefine it.
//
//   §3  Pointer listeners REMOVED. Under the chat input the wave field
//       is decoration, not an interactive surface. Listening for
//       pointermove/leave costs CPU on every frame we're not redrawing
//       and the pointer-push animation just steals attention from the
//       prompt itself.
//
//   §4  Pulse throttle slowed from `240 + rand*180` → `600 + rand*400`.
//       Calmer activity reads as "alive" without flicker.
//
// Also note `maxConcurrentPulses` is forced to 1 in
// motion-background-utils.ts.

import { useEffect, useRef } from "react";

import {
    MOTION_BRAND,
    type RgbColor,
    getIntelligentWaveFieldConfig,
    hexToRgb,
    resolveDevicePixelRatio,
    shouldReduceMotion,
} from "./motion-background-utils";

interface WaveFieldNode {
    activity: number;
    baseX: number;
    baseY: number;
    b: number;
    col: number;
    displayOpacity: number;
    displaySize: number;
    g: number;
    phase: number;
    pulseColor: RgbColor | null;
    r: number;
    row: number;
    waveHeight: number;
    x: number;
    y: number;
}

interface Pulse {
    age: number;
    color: RgbColor;
    dirBias: number;
    dirStrength: number;
    frontier: number[];
    intensity: number;
    maxAge: number;
    visited: Set<number>;
}

function blendColor(start: RgbColor, end: RgbColor, amount: number): RgbColor {
    return {
        r: Math.round(start.r + (end.r - start.r) * amount),
        g: Math.round(start.g + (end.g - start.g) * amount),
        b: Math.round(start.b + (end.b - start.b) * amount),
    };
}

function getNodeIndex(
    col: number,
    row: number,
    cols: number,
    rows: number,
): number {
    if (col < 0 || col >= cols || row < 0 || row >= rows) {
        return -1;
    }
    return row * cols + col;
}

export function IntelligentWaveField() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | null>(null);
    const timeRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        const parent = canvas.parentElement;
        if (!ctx || !parent) return;

        const blueRgb = hexToRgb(MOTION_BRAND.blue);
        const cyanRgb = hexToRgb(MOTION_BRAND.cyan);
        const purpleRgb = hexToRgb(MOTION_BRAND.purple);
        const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

        let width = 0;
        let height = 0;
        let cols = 0;
        let rows = 0;
        let nodes: WaveFieldNode[] = [];
        let pulses: Pulse[] = [];
        let lastPulseTime = -200;
        let reduceMotion = shouldReduceMotion(window);

        const cancelFrame = () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };

        const resizeCanvas = () => {
            const rect = parent.getBoundingClientRect();
            width = Math.max(rect.width, 1);
            height = Math.max(rect.height, 1);
            const dpr = resolveDevicePixelRatio(window.devicePixelRatio);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const buildGrid = () => {
            resizeCanvas();
            const config = getIntelligentWaveFieldConfig(width);
            cols = Math.ceil(width / config.spacing) + 4;
            rows = Math.ceil(height / config.spacing) + 4;

            const offsetX = (width - (cols - 1) * config.spacing) / 2;
            const offsetY = (height - (rows - 1) * config.spacing) / 2;

            nodes = [];
            for (let row = 0; row < rows; row += 1) {
                for (let col = 0; col < cols; col += 1) {
                    const jitterX = (Math.random() - 0.5) * config.spacing * 0.12;
                    const jitterY = (Math.random() - 0.5) * config.spacing * 0.12;
                    nodes.push({
                        activity: 0,
                        baseX: offsetX + col * config.spacing + jitterX,
                        baseY: offsetY + row * config.spacing + jitterY,
                        b: blueRgb.b,
                        col,
                        displayOpacity: 0,
                        displaySize: 0,
                        g: blueRgb.g,
                        phase: Math.random() * Math.PI * 2,
                        pulseColor: null,
                        r: blueRgb.r,
                        row,
                        waveHeight: 0,
                        x: 0,
                        y: 0,
                    });
                }
            }
            pulses = [];
            lastPulseTime = -200;
        };

        const getBaseColor = (normalized: number): RgbColor => {
            if (normalized < 0.4) {
                return blendColor(purpleRgb, blueRgb, normalized / 0.4);
            }
            return blendColor(blueRgb, cyanRgb, (normalized - 0.4) / 0.6);
        };

        const draw = (animate: boolean) => {
            const config = getIntelligentWaveFieldConfig(width);
            const time = animate ? (timeRef.current += 1) : 240;
            ctx.clearRect(0, 0, width, height);

            const centerX = width / 2;
            const centerY = height * 0.43;

            // §4: Pulse throttle slowed from 240+rand*180 → 600+rand*400.
            // Lower visual activity = better background, not foreground.
            if (
                animate &&
                time - lastPulseTime > 600 + Math.random() * 400 &&
                pulses.length < config.maxConcurrentPulses
            ) {
                lastPulseTime = time;
                const startCol = Math.floor(cols / 2 + (Math.random() - 0.5) * 8);
                const startRow = Math.floor(rows * 0.43 + (Math.random() - 0.5) * 6);
                const startIdx = getNodeIndex(startCol, startRow, cols, rows);

                if (startIdx >= 0) {
                    const colorRoll = Math.random();
                    const pulseColor =
                        colorRoll < 0.55
                            ? cyanRgb
                            : colorRoll < 0.85
                              ? blueRgb
                              : purpleRgb;
                    pulses.push({
                        age: 0,
                        color: pulseColor,
                        dirBias: Math.random() * Math.PI * 2,
                        dirStrength: 0.25 + Math.random() * 0.35,
                        frontier: [startIdx],
                        intensity: 0.4 + Math.random() * 0.3,
                        maxAge: 90 + Math.floor(Math.random() * 50),
                        visited: new Set([startIdx]),
                    });
                }
            }

            if (animate) {
                for (
                    let pulseIndex = pulses.length - 1;
                    pulseIndex >= 0;
                    pulseIndex -= 1
                ) {
                    const pulse = pulses[pulseIndex];
                    if (!pulse) continue;
                    pulse.age += 1;
                    if (pulse.age > pulse.maxAge) {
                        pulses.splice(pulseIndex, 1);
                        continue;
                    }
                    const fadeFactor = Math.max(0, 1 - pulse.age / pulse.maxAge);
                    const easedFade = fadeFactor * fadeFactor;
                    for (const nodeIndex of pulse.frontier) {
                        const node = nodes[nodeIndex];
                        if (!node) continue;
                        node.activity = Math.min(
                            0.8,
                            node.activity + pulse.intensity * 0.3 * easedFade,
                        );
                        node.pulseColor = pulse.color;
                    }
                    if (pulse.age % 6 === 0 && pulse.frontier.length > 0) {
                        const newFrontier: number[] = [];
                        for (const nodeIndex of pulse.frontier) {
                            const node = nodes[nodeIndex];
                            if (!node) continue;
                            const neighborIndexes = [
                                getNodeIndex(node.col - 1, node.row, cols, rows),
                                getNodeIndex(node.col + 1, node.row, cols, rows),
                                getNodeIndex(node.col, node.row - 1, cols, rows),
                                getNodeIndex(node.col, node.row + 1, cols, rows),
                            ];
                            if (config.includeDiagonalConnections) {
                                neighborIndexes.push(
                                    getNodeIndex(
                                        node.col - 1,
                                        node.row - 1,
                                        cols,
                                        rows,
                                    ),
                                    getNodeIndex(
                                        node.col + 1,
                                        node.row - 1,
                                        cols,
                                        rows,
                                    ),
                                    getNodeIndex(
                                        node.col - 1,
                                        node.row + 1,
                                        cols,
                                        rows,
                                    ),
                                    getNodeIndex(
                                        node.col + 1,
                                        node.row + 1,
                                        cols,
                                        rows,
                                    ),
                                );
                            }
                            for (const neighborIndex of neighborIndexes) {
                                if (
                                    neighborIndex < 0 ||
                                    pulse.visited.has(neighborIndex)
                                )
                                    continue;
                                const neighbor = nodes[neighborIndex];
                                if (!neighbor) continue;
                                const dx = neighbor.baseX - node.baseX;
                                const dy = neighbor.baseY - node.baseY;
                                const angle = Math.atan2(dy, dx);
                                const angleDiff = Math.abs(angle - pulse.dirBias);
                                const directionBias =
                                    1 -
                                    pulse.dirStrength * (angleDiff / Math.PI);
                                if (Math.random() < directionBias * 0.45) {
                                    pulse.visited.add(neighborIndex);
                                    newFrontier.push(neighborIndex);
                                }
                            }
                        }
                        pulse.frontier = newFrontier;
                    }
                }
            }

            for (const node of nodes) {
                const dx = node.baseX - centerX;
                const dy = node.baseY - centerY;
                const distanceFromCenter = Math.hypot(dx, dy);
                const wave1 =
                    Math.sin(distanceFromCenter * 0.012 - time * 0.018) * 0.45;
                const wave2 =
                    Math.sin((node.baseX + node.baseY) * 0.008 + time * 0.012) *
                    0.25;
                const wave3 =
                    Math.sin(
                        node.baseX * 0.01 - time * 0.022 + node.baseY * 0.003,
                    ) * 0.2;
                const wave4 =
                    Math.sin(distanceFromCenter * 0.006 + time * 0.008) * 0.18;
                node.waveHeight = (wave1 + wave2 + wave3 + wave4) / 1.08;
                node.x = node.baseX + Math.sin(time * 0.005 + node.phase);
                node.y = node.baseY + node.waveHeight * -5;

                // §3: Pointer-push branch removed. The field is purely
                // ambient under the prompt; no listeners means no per-
                // frame mouse math and no fighting with the input's own
                // hover affordances.
                node.activity = animate ? node.activity * 0.97 : 0;
            }

            const maxViewDistance = Math.max(width, height) * 0.58;

            for (const node of nodes) {
                const distanceFromCenter = Math.hypot(
                    node.baseX - centerX,
                    (node.baseY - centerY) * 1.2,
                );
                const centerFade = Math.max(
                    0,
                    1 - distanceFromCenter / maxViewDistance,
                );
                const normalized = (node.waveHeight + 1) / 2;
                const baseSize = 0.5 + normalized * 1.5;
                const baseOpacity =
                    (0.12 + normalized * 0.32) * (0.2 + centerFade * 0.8);
                const activityBoost = animate ? node.activity : 0;
                const baseColor = getBaseColor(normalized);

                node.displaySize = baseSize + activityBoost * 2.5;
                node.displayOpacity = Math.min(
                    0.85,
                    baseOpacity + activityBoost * 0.55,
                );

                const activeColor =
                    activityBoost > 0.1 && node.pulseColor
                        ? blendColor(
                              baseColor,
                              node.pulseColor,
                              Math.min(1, activityBoost * 1.8),
                          )
                        : baseColor;
                node.r = activeColor.r;
                node.g = activeColor.g;
                node.b = activeColor.b;
            }

            for (let index = 0; index < nodes.length; index += 1) {
                const node = nodes[index];
                if (!node) continue;
                if (node.displayOpacity < 0.03) continue;

                const drawConnection = (neighbor: WaveFieldNode | undefined) => {
                    if (!neighbor) return;
                    const averageActivity =
                        (node.activity + neighbor.activity) / 2;
                    const averageOpacity =
                        (node.displayOpacity + neighbor.displayOpacity) / 2;
                    const lineOpacity =
                        averageOpacity * 0.38 + averageActivity * 0.4;
                    if (lineOpacity <= 0.012) return;
                    const lineColor = {
                        r: Math.round((node.r + neighbor.r) / 2),
                        g: Math.round((node.g + neighbor.g) / 2),
                        b: Math.round((node.b + neighbor.b) / 2),
                    };
                    ctx.beginPath();
                    ctx.moveTo(node.x, node.y);
                    ctx.lineTo(neighbor.x, neighbor.y);
                    ctx.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, ${lineOpacity})`;
                    ctx.lineWidth = 0.4 + averageActivity;
                    ctx.stroke();

                    if (averageActivity > 0.2) {
                        ctx.beginPath();
                        ctx.moveTo(node.x, node.y);
                        ctx.lineTo(neighbor.x, neighbor.y);
                        ctx.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, ${averageActivity * 0.06})`;
                        ctx.lineWidth = 3 + averageActivity * 5;
                        ctx.stroke();
                    }
                };

                if (node.col < cols - 1) drawConnection(nodes[index + 1]);
                if (node.row < rows - 1) drawConnection(nodes[index + cols]);

                if (
                    config.includeDiagonalConnections &&
                    node.col < cols - 1 &&
                    node.row < rows - 1 &&
                    node.activity > 0.2
                ) {
                    const diagonal = nodes[index + cols + 1];
                    if (diagonal && diagonal.activity > 0.2) {
                        const averageActivity =
                            (node.activity + diagonal.activity) / 2;
                        const lineOpacity = averageActivity * 0.15;
                        ctx.beginPath();
                        ctx.moveTo(node.x, node.y);
                        ctx.lineTo(diagonal.x, diagonal.y);
                        ctx.strokeStyle = `rgba(${Math.round((node.r + diagonal.r) / 2)}, ${Math.round((node.g + diagonal.g) / 2)}, ${Math.round((node.b + diagonal.b) / 2)}, ${lineOpacity})`;
                        ctx.lineWidth = 0.3 + averageActivity * 0.6;
                        ctx.stroke();
                    }
                }
            }

            for (const node of nodes) {
                if (node.displayOpacity < 0.02) continue;
                if (node.displayOpacity > 0.08 && node.displaySize > 1) {
                    const glowSize = node.displaySize * (2.5 + node.activity * 4);
                    const glow = ctx.createRadialGradient(
                        node.x,
                        node.y,
                        0,
                        node.x,
                        node.y,
                        glowSize,
                    );
                    glow.addColorStop(
                        0,
                        `rgba(${node.r}, ${node.g}, ${node.b}, ${node.displayOpacity * 0.2})`,
                    );
                    glow.addColorStop(
                        0.5,
                        `rgba(${node.r}, ${node.g}, ${node.b}, ${node.displayOpacity * 0.05})`,
                    );
                    glow.addColorStop(
                        1,
                        `rgba(${node.r}, ${node.g}, ${node.b}, 0)`,
                    );
                    ctx.fillStyle = glow;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, glowSize, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.fillStyle = `rgba(${node.r}, ${node.g}, ${node.b}, ${node.displayOpacity})`;
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.displaySize, 0, Math.PI * 2);
                ctx.fill();

                if (animate && node.activity > 0.4) {
                    ctx.fillStyle = `rgba(255, 255, 255, ${(node.activity - 0.4) * 0.5})`;
                    ctx.beginPath();
                    ctx.arc(
                        node.x,
                        node.y,
                        node.displaySize * 0.3,
                        0,
                        Math.PI * 2,
                    );
                    ctx.fill();
                }
            }

            const centerPulse = Math.sin(time * 0.015) * 0.1 + 0.9;
            const centerGlow = ctx.createRadialGradient(
                centerX,
                centerY,
                0,
                centerX,
                centerY,
                100,
            );
            centerGlow.addColorStop(0, `rgba(21, 93, 252, ${0.08 * centerPulse})`);
            centerGlow.addColorStop(
                0.4,
                `rgba(90, 174, 212, ${0.04 * centerPulse})`,
            );
            centerGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = centerGlow;
            ctx.beginPath();
            ctx.arc(centerX, centerY, 100, 0, Math.PI * 2);
            ctx.fill();
        };

        const render = () => {
            draw(true);
            frameRef.current = requestAnimationFrame(render);
        };

        const redrawForMode = () => {
            cancelFrame();
            buildGrid();
            if (reduceMotion) {
                draw(false);
                return;
            }
            render();
        };

        const handleMediaQueryChange = (event: MediaQueryListEvent) => {
            reduceMotion = event.matches;
            redrawForMode();
        };

        const resizeObserver = new ResizeObserver(() => {
            redrawForMode();
        });

        // Pause the rAF loop when the tab is hidden. Chrome throttles
        // backgrounded rAF aggressively, but Safari is much less strict —
        // a long-backgrounded tab can sit at 5-10% CPU just animating
        // wave nodes nobody is looking at. cancelFrame here, then resume
        // on next visible event (skipping when reduceMotion is on since
        // there's no loop running anyway).
        const handleVisibilityChange = () => {
            if (document.hidden) {
                cancelFrame();
            } else if (!reduceMotion) {
                render();
            }
        };

        resizeObserver.observe(parent);
        // §3: pointermove + pointerleave listeners removed. Re-add only
        // if we ever surface the field as a foreground element rather
        // than backdrop chrome.
        mediaQuery.addEventListener("change", handleMediaQueryChange);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        redrawForMode();

        return () => {
            resizeObserver.disconnect();
            mediaQuery.removeEventListener("change", handleMediaQueryChange);
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
            cancelFrame();
        };
    }, []);

    // §2: Dark-gradient overlays removed. Only the canvas remains so the
    // field layers transparently on the app's #0a0a0a background. The
    // call site is responsible for any opacity damping (see EmptyState
    // in app/page.tsx — wraps this with opacity-30).
    return (
        <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>
    );
}
