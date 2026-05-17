// evals/run.ts
//
// Lightweight regression eval for the DealWave Agent.
//
// Required by the take-home prompt:
//   "Required: Include at least one lightweight evaluation approach
//    (a test set, rubric, or hallucination regression check)."
//
// For each test case:
//   1. Runs the Haiku tool loop (same config as app/api/chat/route.ts)
//   2. Captures which tools the agent autonomously decided to call
//   3. Runs the advisor step if analysis tools fired
//   4. Asserts on: tools-called, recommendation, dealScore range,
//      narrative content markers, optional no-verdict cases
//   5. Reports pass/fail + latency + token usage per case
//
// Production extension: wire to GitHub Actions on PR — fail the build
// on any regression. A more thorough hallucination check would diff
// every numeric in verdict.metrics against the tool's actual return.
//
// Run: `pnpm eval`

// CRITICAL: ./env must be the FIRST import. It loads .env.local before
// any other module reads process.env at import-time. Reordering breaks
// the eval — dealwave-client.ts throws at import if its env vars aren't
// set, and JS hoists all imports before any inline code runs.
import "./env";

import { generateObject, stepCountIs, streamText } from "ai";
import { analyzeDealTool } from "../lib/tools/analyze-deal";
import { pullCompsTool } from "../lib/tools/pull-comps";
import { VerdictSchema } from "../lib/schemas/verdict";
import testCases from "./test-cases.json" with { type: "json" };

// Match the system prompt from app/api/chat/route.ts (Haiku) so the
// eval exercises the SAME agent behavior the production app gets.
// Note: create_deal tool is INTENTIONALLY excluded from the eval —
// it would kick off a Workflow SDK durable function, which requires
// the Next.js runtime to be running. The eval is a unit-level check
// of the agent's analysis behavior, not the save-and-track flow.
const SYSTEM_PROMPT = `You are a real estate deal analyst assistant for DealWave.

When a user provides a property address, call analyze_deal first.
After analyze_deal returns, you MUST immediately call pull_comps WITHOUT
asking the user FIRST when ANY of these signals appear:
- confidenceScore < 60
- compCount < 3
- any riskFlag with severity >= 4 mentioning valuation, ARV, or pricing

DO NOT ask "would you like me to pull comps?" — call the tool.

For deal recommendations, cite specific dealGrade, dealScore, and
either arvEstimate or mao from the tool results. Never invent numbers.
Be concise. Lead with the recommendation, then numbers, then caveats.`;

const ADVISOR_PROMPT = `You produce a real-estate deal analysis as
a structured verdict for a single-family investor.

Use ONLY values from the tool results provided. Never invent figures.
If pull_comps wasn't called, set dataConfidence based on analyze_deal's
confidenceScore alone.

Pick the recommendedStrategy that maximizes this deal's economics.

Metric tiles: pick 4-6 tiles relevant to the chosen strategy.
Health logic: "strong" (green) above target, "concern" (red) below,
"neutral" (white) informational.`;

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

interface TestCase {
    id: string;
    description: string;
    input: string;
    expected: {
        toolsCalled: string[];
        recommendation?: string[];
        dealScoreMin?: number;
        dealScoreMax?: number;
        narrativeIncludes?: string[];
        noVerdict?: boolean;
    };
}

interface Assertion {
    name: string;
    pass: boolean;
    detail?: string;
}

interface CaseResult {
    id: string;
    description: string;
    passed: boolean;
    latencyMs: number;
    totalTokens: number;
    toolsCalled: string[];
    verdictRecommendation: string | null;
    assertions: Assertion[];
}

// ────────────────────────────────────────────────────────────────────
// Run a single test case
// ────────────────────────────────────────────────────────────────────

async function runCase(testCase: TestCase): Promise<CaseResult> {
    const start = Date.now();
    const toolsCalled: string[] = [];
    let totalTokens = 0;

    // ── Haiku tool loop ──────────────────────────────────────────
    const loop = streamText({
        model: "anthropic/claude-haiku-4-5",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: testCase.input }],
        tools: {
            analyze_deal: analyzeDealTool,
            pull_comps: pullCompsTool,
            // create_deal intentionally omitted (see header comment)
        },
        stopWhen: stepCountIs(8),
        onStepFinish: ({ usage, toolCalls }) => {
            totalTokens += usage.totalTokens ?? 0;
            for (const tc of toolCalls ?? []) {
                if (!toolsCalled.includes(tc.toolName)) {
                    toolsCalled.push(tc.toolName);
                }
            }
        },
    });

    // Consume the stream — we don't render it, we just need it to complete.
    for await (const _ of loop.textStream) {
        // discard
    }
    const finalResponse = await loop.response;

    // ── Extract analysis tool results for advisor step ───────────
    const analysisResults: { tool: string; output: unknown }[] = [];
    for (const m of finalResponse.messages) {
        if (!Array.isArray(m.content)) continue;
        for (const part of m.content as Array<{
            type: string;
            toolName?: string;
            output?: unknown;
        }>) {
            if (
                part.type === "tool-result" &&
                (part.toolName === "analyze_deal" ||
                    part.toolName === "pull_comps")
            ) {
                analysisResults.push({
                    tool: part.toolName,
                    output: part.output,
                });
            }
        }
    }

    // ── Advisor step (skip if no analysis tools fired) ───────────
    let verdict: import("zod").infer<typeof VerdictSchema> | null = null;
    if (analysisResults.length > 0) {
        try {
            const { object, usage } = await generateObject({
                model: "anthropic/claude-sonnet-4-6",
                schema: VerdictSchema,
                system: ADVISOR_PROMPT,
                prompt: `Produce a structured Verdict from these tool results:

${JSON.stringify(analysisResults, null, 2)}`,
            });
            verdict = object;
            totalTokens += usage.totalTokens ?? 0;
        } catch (err) {
            // Advisor step can fail (Zod rejection, network) — record but
            // don't crash. Drill into the error chain to surface the
            // specific Zod issue(s) so we can debug schema violations.
            const e = err as Error & {
                cause?: Error & { cause?: { issues?: unknown[] } };
            };
            console.error(`  advisor error: ${e.message}`);
            // AI_NoObjectGeneratedError wraps a TypeValidationError which
            // wraps a ZodError. We want the actual Zod issues array.
            const zodIssues = e.cause?.cause?.issues;
            if (zodIssues) {
                console.error(
                    `    Zod issues: ${JSON.stringify(zodIssues, null, 2)}`,
                );
            }
        }
    }

    // ── Assertions ───────────────────────────────────────────────
    const assertions: Assertion[] = [];

    // 1. Tools called set
    const expectedTools = new Set(testCase.expected.toolsCalled);
    const actualTools = new Set(toolsCalled);
    const toolsMatch =
        expectedTools.size === actualTools.size &&
        [...expectedTools].every((t) => actualTools.has(t));
    assertions.push({
        name: "tools-called",
        pass: toolsMatch,
        detail: toolsMatch
            ? undefined
            : `expected [${[...expectedTools].join(", ")}], got [${[...actualTools].join(", ")}]`,
    });

    if (testCase.expected.noVerdict) {
        // Negative case — must NOT have a verdict
        assertions.push({
            name: "no-verdict-emitted",
            pass: verdict === null,
            detail:
                verdict === null
                    ? undefined
                    : "verdict was emitted on an off-topic question",
        });
    } else if (verdict) {
        // 2. Recommendation in expected set
        if (testCase.expected.recommendation) {
            const recOk = testCase.expected.recommendation.includes(
                verdict.recommendation,
            );
            assertions.push({
                name: "recommendation-in-expected-set",
                pass: recOk,
                detail: recOk
                    ? `got '${verdict.recommendation}'`
                    : `got '${verdict.recommendation}', expected one of [${testCase.expected.recommendation.join(", ")}]`,
            });
        }

        // 3. dealScore within bounds
        if (
            testCase.expected.dealScoreMin !== undefined &&
            testCase.expected.dealScoreMax !== undefined
        ) {
            const scoreOk =
                verdict.dealScore >= testCase.expected.dealScoreMin &&
                verdict.dealScore <= testCase.expected.dealScoreMax;
            assertions.push({
                name: "dealScore-in-bounds",
                pass: scoreOk,
                detail: `got ${verdict.dealScore}, expected ${testCase.expected.dealScoreMin}-${testCase.expected.dealScoreMax}`,
            });
        }

        // 4. Narrative includes expected markers
        if (testCase.expected.narrativeIncludes) {
            const narrative = verdict.narrative.toLowerCase();
            const missing = testCase.expected.narrativeIncludes.filter(
                (marker) => !narrative.includes(marker.toLowerCase()),
            );
            assertions.push({
                name: "narrative-includes-markers",
                pass: missing.length === 0,
                detail:
                    missing.length === 0
                        ? undefined
                        : `missing markers: [${missing.join(", ")}]`,
            });
        }
    } else if (testCase.expected.recommendation) {
        // Expected a verdict but didn't get one
        assertions.push({
            name: "verdict-emitted",
            pass: false,
            detail: "expected a verdict but the advisor step returned null",
        });
    }

    const passed = assertions.every((a) => a.pass);

    return {
        id: testCase.id,
        description: testCase.description,
        passed,
        latencyMs: Date.now() - start,
        totalTokens,
        toolsCalled,
        verdictRecommendation: verdict?.recommendation ?? null,
        assertions,
    };
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main() {
    const cases = (testCases as { cases: TestCase[] }).cases;

    console.log(`\n🧪 DealWave Agent Eval Suite`);
    console.log(`   ${cases.length} test cases\n`);

    const results: CaseResult[] = [];
    for (const tc of cases) {
        console.log(`▶ ${tc.id}`);
        console.log(`  ${tc.description}`);
        const result = await runCase(tc);
        results.push(result);

        const status = result.passed ? "✅ PASS" : "❌ FAIL";
        console.log(
            `  ${status}  ${(result.latencyMs / 1000).toFixed(1)}s · ${result.totalTokens} tokens`,
        );
        for (const a of result.assertions) {
            const icon = a.pass ? "✓" : "✗";
            console.log(
                `    ${icon} ${a.name}${a.detail ? ` — ${a.detail}` : ""}`,
            );
        }
        console.log();
    }

    // Summary
    const passCount = results.filter((r) => r.passed).length;
    const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);
    const totalTokens = results.reduce((sum, r) => sum + r.totalTokens, 0);

    console.log(`📊 Summary`);
    console.log(`   ${passCount}/${results.length} cases passed`);
    console.log(`   Total latency: ${(totalLatency / 1000).toFixed(1)}s`);
    console.log(`   Total tokens:  ${totalTokens}`);
    console.log();

    // Exit non-zero on any failure (CI-friendly)
    process.exit(passCount === results.length ? 0 : 1);
}

main().catch((err) => {
    console.error("\n💥 Eval crashed:", err);
    process.exit(1);
});
