import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diagnose,
  percentile90,
  peakContextThresholdFor,
  THRESHOLDS,
  type DiagnosticContext,
  type DiagnosticInput,
} from "./diagnostics.ts";

const quiet: DiagnosticInput = {
  claudeMdLines: 80,
  peakContextTokens: 40_000,
  compactionCount: 0,
  cacheRatio: 0.9,
  inputSideTokens: 200_000,
  promptCount: 5,
  commitCount: 1,
  editAccepted: 8,
  editRejected: 1,
  toolCalls: 40,
  toolErrors: 2,
  apiErrorCount: 0,
  effort: "medium",
  linesChanged: 300,
  opusCostShare: 0,
  costUsd: 1,
};
const ctx: DiagnosticContext = { peakContextThreshold: 150_000, baseline: null };
const ids = (input: Partial<DiagnosticInput>, context: DiagnosticContext = ctx) =>
  diagnose({ ...quiet, ...input }, context).map((d) => d.id);

test("a healthy session produces no diagnostics", () => {
  assert.deepEqual(ids({}), []);
});

test("a session from an older collector (everything unknown) produces no diagnostics", () => {
  const unknown: DiagnosticInput = {
    claudeMdLines: null, peakContextTokens: null, compactionCount: null, cacheRatio: null,
    inputSideTokens: 0, promptCount: null, commitCount: null, editAccepted: null, editRejected: null,
    toolCalls: null, toolErrors: null, apiErrorCount: null, effort: null, linesChanged: null,
    opusCostShare: null, costUsd: 0.5,
  };
  assert.deepEqual(diagnose(unknown, ctx), []);
});

test("CLAUDE.md over 200 lines (documented guidance) is flagged, exactly 200 is not", () => {
  assert.deepEqual(ids({ claudeMdLines: 201 }), ["claudemd-long"]);
  assert.deepEqual(ids({ claudeMdLines: THRESHOLDS.claudeMdLines }), []);
});

test("heavy context uses the supplied threshold", () => {
  assert.deepEqual(ids({ peakContextTokens: 149_999 }), []);
  assert.deepEqual(ids({ peakContextTokens: 150_000 }), ["context-heavy"]);
  assert.deepEqual(ids({ peakContextTokens: 100_000 }, { ...ctx, peakContextThreshold: 90_000 }), ["context-heavy"]);
});

test("repeated compactions need 2+", () => {
  assert.deepEqual(ids({ compactionCount: 1 }), []);
  assert.deepEqual(ids({ compactionCount: 2 }), ["repeated-compactions"]);
});

test("low cache ratio is ignored on short sessions and softened when compactions explain it", () => {
  assert.deepEqual(ids({ cacheRatio: 0.2, inputSideTokens: 10_000 }), []);
  const plain = diagnose({ ...quiet, cacheRatio: 0.2 }, ctx);
  assert.equal(plain[0].id, "low-cache");
  assert.equal(plain[0].severity, "warn");
  const compacted = diagnose({ ...quiet, cacheRatio: 0.2, compactionCount: 1 }, ctx);
  assert.equal(compacted[0].severity, "info");
});

test("many prompts without a commit: median-based when a baseline exists, absolute otherwise", () => {
  const withBaseline: DiagnosticContext = { ...ctx, baseline: { medianPrompts: 6, medianCostUsd: null } };
  assert.deepEqual(ids({ promptCount: 11, commitCount: 0 }, withBaseline), []);
  assert.deepEqual(ids({ promptCount: 12, commitCount: 0 }, withBaseline), ["many-prompts-no-commit"]);
  assert.deepEqual(ids({ promptCount: 20, commitCount: 1 }, withBaseline), []); // committed
  assert.deepEqual(ids({ promptCount: 14, commitCount: 0 }), []);
  assert.deepEqual(ids({ promptCount: 15, commitCount: 0 }), ["many-prompts-no-commit"]);
  // an unknown commit count is treated as no commit signal; a known zero is what triggers
  assert.deepEqual(ids({ promptCount: 30, commitCount: null }), ["many-prompts-no-commit"]);
});

test("cost outlier compares to the task-type median", () => {
  const withBaseline: DiagnosticContext = { ...ctx, baseline: { medianPrompts: null, medianCostUsd: 2 } };
  assert.deepEqual(ids({ costUsd: 3.9 }, withBaseline), []);
  assert.deepEqual(ids({ costUsd: 4 }, withBaseline), ["cost-outlier"]);
  assert.deepEqual(ids({ costUsd: 400 }), []); // no baseline, no comparison
});

test("rejected edits need enough decisions", () => {
  assert.deepEqual(ids({ editAccepted: 2, editRejected: 2 }), []); // only 4 decisions
  assert.deepEqual(ids({ editAccepted: 7, editRejected: 3 }), ["rejected-edits"]); // exactly 30%
  assert.deepEqual(ids({ editAccepted: 8, editRejected: 2 }), []);
});

test("tool failures need volume", () => {
  assert.deepEqual(ids({ toolCalls: 5, toolErrors: 5 }), []);
  assert.deepEqual(ids({ toolCalls: 20, toolErrors: 4 }), ["tool-failures"]);
});

test("effort and model rules only fire on short, small sessions", () => {
  assert.deepEqual(ids({ effort: "max", promptCount: 2 }), ["effort-on-short-session"]);
  assert.deepEqual(ids({ effort: "max", promptCount: 6 }), []);
  assert.deepEqual(ids({ opusCostShare: 0.9, promptCount: 2, linesChanged: 20 }), ["opus-on-small-task"]);
  assert.deepEqual(ids({ opusCostShare: 0.9, promptCount: 2, linesChanged: 400 }), []);
  assert.deepEqual(ids({ opusCostShare: null, promptCount: 2, linesChanged: 20 }), []);
});

test("api errors are informational", () => {
  const found = diagnose({ ...quiet, apiErrorCount: 3 }, ctx);
  assert.deepEqual(found.map((d) => [d.id, d.severity]), [["api-errors", "info"]]);
});

test("every diagnostic carries evidence and a documentation link", () => {
  const all = diagnose(
    {
      ...quiet, claudeMdLines: 300, peakContextTokens: 200_000, compactionCount: 3, cacheRatio: 0.1,
      promptCount: 2, commitCount: 0, editAccepted: 1, editRejected: 9, toolCalls: 20, toolErrors: 10,
      apiErrorCount: 5, effort: "max", linesChanged: 5, opusCostShare: 1, costUsd: 99,
    },
    { peakContextThreshold: 150_000, baseline: { medianPrompts: 1, medianCostUsd: 1 } }
  );
  assert.ok(all.length >= 9);
  for (const d of all) {
    assert.ok(d.evidence.length > 0, d.id);
    assert.match(d.docUrl, /^https:\/\/code\.claude\.com\/docs\/en\//, d.id);
  }
});

test("percentile90 needs enough history and ignores missing values", () => {
  assert.equal(percentile90([1, 2, 3]), null);
  const values = Array.from({ length: 10 }, (_, i) => (i + 1) * 10_000); // 10k..100k
  assert.equal(percentile90([...values, null, undefined]), 90_000);
});

test("history-based context threshold is floored and falls back to the default", () => {
  assert.equal(peakContextThresholdFor([10_000]), THRESHOLDS.defaultPeakContext);
  const small = Array.from({ length: 12 }, () => 20_000);
  assert.equal(peakContextThresholdFor(small), THRESHOLDS.minPeakContext);
  const big = Array.from({ length: 12 }, () => 300_000);
  assert.equal(peakContextThresholdFor(big), 300_000);
});
