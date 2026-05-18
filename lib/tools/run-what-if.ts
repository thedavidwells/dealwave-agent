// lib/tools/run-what-if.ts
//
// Fifth tool. Runs a Monte Carlo sensitivity simulation on a deal to surface
// the *distribution* of profit outcomes — not just a point estimate.
//
// Why Sandbox: real Monte Carlo needs numpy + matplotlib. That's 30MB+ of
// native binaries; doesn't fit in an Edge serverless bundle. Sandbox isolates
// the Python compute without bloating the app or compromising security.
//
// Pattern: model carries baseline values forward from analyze_deal's output
// (ARV, repairs, purchase price) and calls this tool. Python runs 10k trials
// perturbing ARV / repairs / holding from triangular distributions, returns
// P10/P50/P90, probability of loss, Value-at-Risk, and a histogram PNG.
//
// The triangular distributions are intentionally *asymmetric*:
//   - ARV symmetric (true randomness)
//   - Repairs skew UP (real repairs always cost more than estimates)
//   - Holding skews LONG (deals always take longer than planned)
// This is the actual investor mental model — point estimates lie, mostly
// on the bad side.
//
// Cost: 0 DealWave credits. Sandbox spin-up + pip install ~30-60s on cold
// start, sub-second after numpy is cached. Trade for the interview demo.

import { Sandbox } from "@vercel/sandbox";
import { tool } from "ai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema — model populates from analyze_deal output context
// ---------------------------------------------------------------------------

const runWhatIfInputSchema = z.object({
    address: z
        .string()
        .min(5)
        .max(500)
        .describe(
            "Property address being simulated. Match the address from the most " +
                "recent analyze_deal call so the response can be cross-referenced.",
        ),
    baseline: z
        .object({
            arv: z
                .number()
                .positive()
                .describe("After-repair value point estimate from analyze_deal."),
            purchase_price: z
                .number()
                .positive()
                .describe(
                    "Asking / offer price. From analyze_deal's listing price or " +
                        "MAO if no list price.",
                ),
            repairs: z
                .number()
                .nonnegative()
                .describe("Estimated repair cost from analyze_deal."),
            holding_months: z
                .number()
                .positive()
                .default(4)
                .describe(
                    "Target holding period in months. Default 4 for typical flip.",
                ),
            monthly_holding_cost: z
                .number()
                .nonnegative()
                .default(800)
                .describe(
                    "Carrying cost per month — property tax, insurance, utilities, " +
                        "loan interest. Default $800/mo is reasonable for SFR Boise/Phoenix.",
                ),
            selling_cost_percent: z
                .number()
                .min(0)
                .max(0.2)
                .default(0.08)
                .describe(
                    "Closing + agent costs as fraction of sale price. Default 8% " +
                        "covers 6% agent + 2% closing.",
                ),
        })
        .describe(
            "Baseline deal economics. Pull these from the most recent analyze_deal " +
                "result so the simulation anchors on DealWave's actual numbers.",
        ),
    uncertainty: z
        .object({
            arv_swing_pct: z
                .number()
                .min(0.02)
                .max(0.4)
                .default(0.1)
                .describe(
                    "± symmetric fraction around ARV (e.g., 0.1 = ±10%). Tighten " +
                        "to 0.05 if analyze_deal had high confidence; loosen to 0.20 " +
                        "if comp count was low or comps were noisy.",
                ),
            repairs_skew_up_pct: z
                .number()
                .min(0.05)
                .max(0.6)
                .default(0.3)
                .describe(
                    "Asymmetric upside on repair cost. 0.3 = repairs can come in 30% " +
                        "over estimate. Use 0.5 for older homes / unknown systems.",
                ),
            holding_skew_long_pct: z
                .number()
                .min(0.1)
                .max(2.0)
                .default(1.0)
                .describe(
                    "Asymmetric downside on holding time. 1.0 = holding can stretch " +
                        "to 2x target. Use 1.5 for slow markets.",
                ),
        })
        .optional()
        .describe(
            "Uncertainty ranges for the perturbations. Defaults are reasonable for " +
                "a typical SFR flip; override if analyze_deal flagged low confidence.",
        ),
    trials: z
        .number()
        .int()
        .min(1000)
        .max(50_000)
        .default(10_000)
        .describe(
            "Number of Monte Carlo trials. 10k gives stable percentiles; bump for " +
                "tighter CIs if needed.",
        ),
});

// ---------------------------------------------------------------------------
// Python Monte Carlo script — written into the sandbox as a file
// ---------------------------------------------------------------------------
//
// Reads JSON config from stdin, writes JSON result to stdout. All numeric
// output is plain JSON; the histogram is base64-encoded PNG inside the JSON.

const MONTECARLO_PYTHON = `
import json
import sys
import base64
from io import BytesIO

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def run(cfg):
    b = cfg["baseline"]
    u = cfg.get("uncertainty") or {}
    trials = int(cfg.get("trials", 10_000))

    arv_swing = u.get("arv_swing_pct", 0.1)
    repairs_skew = u.get("repairs_skew_up_pct", 0.3)
    holding_skew = u.get("holding_skew_long_pct", 1.0)

    rng = np.random.default_rng(seed=42)

    # Triangular distributions:
    # - ARV:     symmetric around point estimate (true randomness)
    # - Repairs: skews UP (real repairs always cost more than estimates)
    # - Holding: skews LONG (deals always take longer than planned)
    arv = rng.triangular(
        b["arv"] * (1 - arv_swing),
        b["arv"],
        b["arv"] * (1 + arv_swing),
        trials,
    )
    repairs = rng.triangular(
        b["repairs"] * 0.85,
        b["repairs"],
        b["repairs"] * (1 + repairs_skew),
        trials,
    )
    holding_months = rng.triangular(
        b["holding_months"] * 0.9,
        b["holding_months"],
        b["holding_months"] * (1 + holding_skew),
        trials,
    )

    # Profit = ARV - Purchase - Repairs - Holding - Selling
    selling_costs = arv * b["selling_cost_percent"]
    holding_costs = holding_months * b["monthly_holding_cost"]
    profit = arv - b["purchase_price"] - repairs - holding_costs - selling_costs

    p10, p50, p90 = np.percentile(profit, [10, 50, 90])
    prob_loss = float(np.mean(profit < 0))
    expected = float(np.mean(profit))
    var_95 = float(np.percentile(profit, 5))  # 95% VaR = 5th pctile

    # --- Histogram ---
    fig, ax = plt.subplots(figsize=(7, 3.5), dpi=110)
    ax.hist(profit, bins=60, color="#10b981", edgecolor="#064e3b", alpha=0.85)
    ax.axvline(0, color="#ef4444", linestyle="--", linewidth=2, label="Break-even")
    ax.axvline(
        p50,
        color="#0ea5e9",
        linestyle="-",
        linewidth=2,
        label=f"Median: \${p50:,.0f}",
    )
    ax.set_xlabel("Profit ($)")
    ax.set_ylabel("Frequency")
    ax.set_title(f"Profit distribution — {trials:,} Monte Carlo trials")
    ax.legend(loc="upper left", frameon=False)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.xaxis.set_major_formatter(
        plt.FuncFormatter(lambda x, _: f"\${x/1000:.0f}k")
    )
    fig.tight_layout()

    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return {
        "trials": trials,
        "p10": float(p10),
        "p50": float(p50),
        "p90": float(p90),
        "expected_profit": expected,
        "probability_of_loss": prob_loss,
        "value_at_risk_95": var_95,
        "histogram_png_base64": png_b64,
        "interpretation": (
            f"P(loss) = {prob_loss:.0%}. Median profit \${p50:,.0f}. "
            f"95% VaR = \${var_95:,.0f} — 5% of scenarios are worse than this."
        ),
    }


if __name__ == "__main__":
    cfg = json.loads(sys.stdin.read())
    result = run(cfg)
    print(json.dumps(result))
`.trim();

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const runWhatIfTool = tool({
    description:
        "Runs a Monte Carlo sensitivity simulation on a deal to show the " +
        "DISTRIBUTION of profit outcomes — P10/P50/P90, probability of loss, and " +
        "95% Value-at-Risk. Use this after analyze_deal when the user wants to " +
        "understand risk and variance, not just point estimates. Trigger phrases: " +
        "'how risky is this deal?', 'what if repairs come in higher?', 'show me " +
        "the downside', 'sensitivity analysis', 'monte carlo'. The baseline " +
        "values (arv, purchase_price, repairs) MUST come from the most recent " +
        "analyze_deal result for this address — never invent them.",

    inputSchema: runWhatIfInputSchema,

    execute: async ({ address, baseline, uncertainty, trials }) => {
        // ---- Spin up the sandbox ----
        // Wrap in try/finally so the sandbox always gets cleaned up — even
        // on simulation failure. Sandbox instances cost money to keep alive.
        //
        // Use python3.13 runtime (NOT node22) — only python runtimes include
        // pip and the python3 binary. Node runtimes have no Python.
        const sandbox = await Sandbox.create({
            runtime: "python3.13",
            timeout: 90_000,
        });

        try {
            // ---- Install numpy + matplotlib ----
            // Cold-start cost. Cached after first run on Vercel's side (~3s).
            // We could pre-bundle these into a custom image to skip the install,
            // but the latency is acceptable for the demo.
            const pipInstall = await sandbox.runCommand({
                cmd: "pip",
                args: ["install", "--quiet", "numpy", "matplotlib"],
            });

            if (pipInstall.exitCode !== 0) {
                return {
                    error: true,
                    message: "Failed to install Python dependencies",
                    stderr: await pipInstall.stderr(),
                    hint: "Sandbox runtime may not include pip / Python3. Check the smoke test.",
                };
            }

            // ---- Write the Monte Carlo script + the input JSON ----
            // The Sandbox API doesn't support stdin on runCommand, so the
            // pattern is: write input to a file, then shell-redirect it into
            // python's stdin via `sh -c 'python3 script.py < input.json'`.
            // Note: writeFiles content must be Buffer, not string.
            await sandbox.writeFiles([
                {
                    path: "/tmp/montecarlo.py",
                    content: Buffer.from(MONTECARLO_PYTHON, "utf-8"),
                },
                {
                    path: "/tmp/input.json",
                    content: Buffer.from(
                        JSON.stringify({
                            address,
                            baseline,
                            uncertainty,
                            trials,
                        }),
                        "utf-8",
                    ),
                },
            ]);

            // ---- Run the simulation ----
            // Shell-redirect input.json into python's stdin (workaround for
            // missing stdin param on runCommand).
            const proc = await sandbox.runCommand({
                cmd: "sh",
                args: [
                    "-c",
                    "python3 /tmp/montecarlo.py < /tmp/input.json",
                ],
            });

            if (proc.exitCode !== 0) {
                return {
                    error: true,
                    message: "Monte Carlo simulation failed",
                    stderr: await proc.stderr(),
                    hint: "Check Python script syntax or numpy import.",
                };
            }

            // ---- Parse and return ----
            // Python writes a JSON blob to stdout; parse and pass through.
            // The histogram_png_base64 field is large (~30-50kb) — caller
            // should know to render it via <img src="data:image/png;base64,...">
            // or strip it before logging.
            //
            // Note: stdout/stderr are ASYNC methods on the Sandbox SDK, not
            // properties — must `await` them.
            const stdout = await proc.stdout();
            let result: Record<string, unknown>;
            try {
                result = JSON.parse(stdout);
            } catch (err) {
                return {
                    error: true,
                    message: "Failed to parse Python output as JSON",
                    raw_stdout: stdout.slice(0, 500),
                };
            }

            return {
                ok: true,
                address,
                ...result,
            };
        } finally {
            // Always tear down the sandbox. Eats latency on the happy path
            // but prevents bill creep on errors.
            try {
                await sandbox.stop();
            } catch {
                // sandbox already gone — ignore
            }
        }
    },
});
