import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStatusline } from "./statusline.ts";
import { computeClaudeMdInfo } from "./claude-md.ts";

const baselines = [
  { taskType: "feature", n: 12, medianCostUsd: 2.4, medianPrompts: 6 },
  { taskType: "bugfix", n: 2, medianCostUsd: 0.5, medianPrompts: 2 }, // too few sessions to trust
];

test("full line: context, cache, prompts vs median, cost vs median", () => {
  const line = renderStatusline(
    {
      context_window: { used_percentage: 62.4 },
      cost: { total_cost_usd: 1.8 },
      prompt_cache: { caching_observed: true, warm: true, hit_ratio: 0.91 },
    },
    { signals: { promptCount: 4, commitCount: 1 }, branch: "feat/thing", baselines }
  );
  assert.equal(line, "ctx 62% | cache 91% | 4 prompts, 1 commit (med 6) | $1.80 (med feature $2.40)");
});

test("warns when prompts pass 2x the median with no commit, and when cost passes 2x the median", () => {
  const line = renderStatusline(
    { cost: { total_cost_usd: 5.5 } },
    { signals: { promptCount: 13, commitCount: 0 }, branch: "feat/thing", baselines }
  );
  assert.match(line, /13 prompts \(med 6\) no commit yet !/);
  assert.match(line, /\$5\.50 \(med feature \$2\.40\) !/);
});

test("baselines with too few sessions are ignored; absolute prompt threshold applies instead", () => {
  const calm = renderStatusline({}, { signals: { promptCount: 10, commitCount: 0 }, branch: "fix/x", baselines });
  assert.equal(calm, "10 prompts");
  const warned = renderStatusline({}, { signals: { promptCount: 15, commitCount: 0 }, branch: "fix/x", baselines });
  assert.equal(warned, "15 prompts no commit yet !");
});

test("cold cache and high context are flagged; missing data produces no segments", () => {
  const line = renderStatusline(
    { context_window: { used_percentage: 85 }, prompt_cache: { caching_observed: true, warm: false } },
    { signals: null, branch: null, baselines: [] }
  );
  assert.equal(line, "ctx 85% ! | cache COLD");
  assert.equal(renderStatusline({}, { signals: null, branch: null, baselines: [] }), "");
});

test("claude.md fingerprint is stable across CRLF, changes with content, and is null when absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "devmeter-md-"));
  assert.equal(computeClaudeMdInfo(dir), null);

  writeFileSync(join(dir, "CLAUDE.md"), "# Rules\nbe nice\n");
  const lf = computeClaudeMdInfo(dir);
  writeFileSync(join(dir, "CLAUDE.md"), "# Rules\r\nbe nice\r\n");
  const crlf = computeClaudeMdInfo(dir);
  assert.deepEqual(lf, crlf);
  assert.equal(lf?.lines, 2);
  assert.match(lf!.hash, /^[0-9a-f]{12}$/);

  writeFileSync(join(dir, "CLAUDE.md"), "# Rules\nbe rude\n");
  assert.notEqual(computeClaudeMdInfo(dir)?.hash, lf?.hash);
});
