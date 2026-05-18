// components/dealwave/monte-carlo-panel.tsx
//
// Renders the Monte Carlo sensitivity analysis section on the deal
// detail page. Two states:
//   - Data present: renders the histogram (base64 PNG from run_what_if)
//     plus P10/P50/P90 + P(loss) + 95% VaR tiles + interpretation
//   - Data missing: empty state inviting the user to run a Monte Carlo
//     from the chat (the agent's run_what_if tool)
//
// Pure server component — no state, no interactivity.

const C = {
    sf: "#111111",
    bd: "rgba(255,255,255,0.08)",
    text: "#fafafa",
    sub: "rgba(255,255,255,0.55)",
    dim: "rgba(255,255,255,0.28)",
    font: '"Geist", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"Geist Mono", monospace',
    green: "#22c55e",
    red: "#ef4444",
    blue: "#60a5fa",
};

export interface MonteCarloData {
    p10: number;
    p50: number;
    p90: number;
    probability_of_loss: number;
    value_at_risk_95: number;
    trials: number;
    histogram_png_base64?: string;
    interpretation?: string;
}

export function MonteCarloPanel({ data }: { data: MonteCarloData | null }) {
    if (!data) {
        return (
            <div
                style={{
                    background: C.sf,
                    border: `1px solid ${C.bd}`,
                    borderRadius: 7,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <div style={{ marginBottom: 14 }}>
                    <div
                        style={{
                            fontFamily: C.font,
                            fontSize: 14,
                            fontWeight: 600,
                            color: C.text,
                            marginBottom: 4,
                        }}
                    >
                        Monte Carlo Sensitivity Analysis
                    </div>
                    <div
                        style={{
                            fontFamily: C.font,
                            fontSize: 11,
                            color: C.dim,
                        }}
                    >
                        Not yet run for this deal
                    </div>
                </div>
                <div
                    style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "40px 16px",
                        background: "rgba(255,255,255,0.02)",
                        border: `1px dashed ${C.bd}`,
                        borderRadius: 5,
                        textAlign: "center",
                    }}
                >
                    <div style={{ fontSize: 24, marginBottom: 12 }}>📊</div>
                    <div
                        style={{
                            fontFamily: C.font,
                            fontSize: 13,
                            color: C.sub,
                            lineHeight: 1.5,
                            marginBottom: 8,
                            maxWidth: 320,
                        }}
                    >
                        Run a Monte Carlo from chat to surface P10/P50/P90
                        profit distribution + probability of loss for this deal.
                    </div>
                    <div
                        style={{
                            fontFamily: C.mono,
                            fontSize: 11,
                            color: C.dim,
                            marginTop: 4,
                        }}
                    >
                        Powered by Vercel Sandbox · numpy + matplotlib
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                background: C.sf,
                border: `1px solid ${C.bd}`,
                borderRadius: 7,
                padding: 16,
            }}
        >
            <div style={{ marginBottom: 14 }}>
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 14,
                        fontWeight: 600,
                        color: C.text,
                        marginBottom: 4,
                    }}
                >
                    Monte Carlo Sensitivity Analysis
                </div>
                <div
                    style={{
                        fontFamily: C.font,
                        fontSize: 11,
                        color: C.dim,
                    }}
                >
                    {data.trials.toLocaleString()} trials · ±20% ARV swing,
                    repairs up to +30%, holding 2× baseline
                </div>
            </div>

            {/* Histogram */}
            {data.histogram_png_base64 && (
                <div
                    style={{
                        width: "100%",
                        background: "#fff",
                        borderRadius: 5,
                        marginBottom: 14,
                        overflow: "hidden",
                    }}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={`data:image/png;base64,${data.histogram_png_base64}`}
                        alt="Profit distribution histogram"
                        style={{
                            width: "100%",
                            display: "block",
                        }}
                    />
                </div>
            )}

            {/* P10/P50/P90 */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 1,
                    background: C.bd,
                    marginBottom: 12,
                }}
            >
                <PctTile
                    label="P10 (DOWNSIDE)"
                    value={`$${(data.p10 / 1000).toFixed(1)}k`}
                    color={C.red}
                />
                <PctTile
                    label="P50 (MEDIAN)"
                    value={`$${(data.p50 / 1000).toFixed(1)}k`}
                    color={C.green}
                />
                <PctTile
                    label="P90 (UPSIDE)"
                    value={`$${(data.p90 / 1000).toFixed(1)}k`}
                    color={C.blue}
                />
            </div>

            {/* P(LOSS) + 95% VaR */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                }}
            >
                <div
                    style={{
                        padding: "10px 12px",
                        background: "rgba(34,197,94,0.08)",
                        border: "1px solid rgba(34,197,94,0.2)",
                        borderRadius: 5,
                    }}
                >
                    <div
                        style={{
                            fontFamily: C.font,
                            fontSize: 10,
                            color: C.dim,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            marginBottom: 3,
                        }}
                    >
                        P(LOSS)
                    </div>
                    <div
                        style={{
                            fontFamily: C.mono,
                            fontSize: 20,
                            fontWeight: 700,
                            color: C.green,
                        }}
                    >
                        {(data.probability_of_loss * 100).toFixed(0)}%
                    </div>
                </div>
                <div
                    style={{
                        padding: "10px 12px",
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${C.bd}`,
                        borderRadius: 5,
                    }}
                >
                    <div
                        style={{
                            fontFamily: C.font,
                            fontSize: 10,
                            color: C.dim,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            marginBottom: 3,
                        }}
                    >
                        95% VAR
                    </div>
                    <div
                        style={{
                            fontFamily: C.mono,
                            fontSize: 20,
                            fontWeight: 700,
                            color: C.sub,
                        }}
                    >
                        ${(data.value_at_risk_95 / 1000).toFixed(1)}k
                    </div>
                </div>
            </div>

            {/* Interpretation */}
            {data.interpretation && (
                <div
                    style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${C.bd}`,
                        borderRadius: 5,
                    }}
                >
                    <div
                        style={{
                            fontFamily: C.font,
                            fontSize: 11,
                            color: C.sub,
                            lineHeight: 1.6,
                        }}
                    >
                        {data.interpretation}
                    </div>
                </div>
            )}
        </div>
    );
}

function PctTile({
    label,
    value,
    color,
}: {
    label: string;
    value: string;
    color: string;
}) {
    return (
        <div
            style={{
                padding: "10px 12px",
                background: "rgba(255,255,255,0.02)",
            }}
        >
            <div
                style={{
                    fontFamily: C.font,
                    fontSize: 10,
                    color: C.dim,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 3,
                }}
            >
                {label}
            </div>
            <div
                style={{
                    fontFamily: C.mono,
                    fontSize: 18,
                    fontWeight: 600,
                    color,
                }}
            >
                {value}
            </div>
        </div>
    );
}
