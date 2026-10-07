import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheRatio, meanOfKnown } from "./session-metrics.ts";
import { deriveTaskType, effectiveTaskType } from "./task-type.ts";

test("cacheRatio = cacheRead / (input + cacheRead + cacheCreation)", () => {
  assert.equal(
    cacheRatio({ tokensInput: 100, tokensCacheRead: 700, tokensCacheCreation: 200 }),
    0.7
  );
  assert.equal(cacheRatio({ tokensInput: 50, tokensCacheRead: 0, tokensCacheCreation: 50 }), 0);
});

test("cacheRatio is null (not 0) when there are no input-side tokens", () => {
  assert.equal(cacheRatio({ tokensInput: 0, tokensCacheRead: 0, tokensCacheCreation: 0 }), null);
});

test("meanOfKnown ignores missing values instead of treating them as 0", () => {
  assert.deepEqual(meanOfKnown([10, null, 20, undefined]), { mean: 15, n: 2 });
  assert.deepEqual(meanOfKnown([null, undefined]), { mean: null, n: 0 });
  assert.deepEqual(meanOfKnown([0, 0]), { mean: 0, n: 2 });
});

test("deriveTaskType maps branch prefixes", () => {
  assert.equal(deriveTaskType("fix/TICKET-1-login"), "bugfix");
  assert.equal(deriveTaskType("bugfix/crash"), "bugfix");
  assert.equal(deriveTaskType("feat/new-thing"), "feature");
  assert.equal(deriveTaskType("feature/192-nom"), "feature");
  assert.equal(deriveTaskType("refactor/auth"), "refactor");
  assert.equal(deriveTaskType("chore/deps"), "chore");
  assert.equal(deriveTaskType("docs/readme"), "docs");
  assert.equal(deriveTaskType("test/e2e"), "test");
  assert.equal(deriveTaskType("FIX/Upper"), "bugfix");
});

test("deriveTaskType falls back to other", () => {
  assert.equal(deriveTaskType("main"), "other");
  assert.equal(deriveTaskType("fix"), "other"); // no slash: a branch literally named "fix"
  assert.equal(deriveTaskType("wip/stuff"), "other");
  assert.equal(deriveTaskType(null), "other");
  assert.equal(deriveTaskType(undefined), "other");
});

test("effectiveTaskType prefers the stored value, else derives (read-only)", () => {
  assert.equal(effectiveTaskType({ taskType: "docs", gitBranch: "fix/x" }), "docs");
  assert.equal(effectiveTaskType({ taskType: null, gitBranch: "fix/x" }), "bugfix");
  assert.equal(effectiveTaskType({ taskType: "garbage", gitBranch: null }), "other");
});
