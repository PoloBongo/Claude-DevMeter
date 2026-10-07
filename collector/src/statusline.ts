import type { Baseline } from "./api-client.ts";
import type { Signals } from "./session-tracker.ts";
import { deriveTaskType } from "./task-type.ts";

/** The subset of Claude Code's statusline stdin JSON this renderer reads; every field may be absent. */
export interface StatuslineInput {
  cwd?: string;
  context_window?: { used_percentage?: number | null };
  cost?: { total_cost_usd?: number | null };
  prompt_cache?: { warm?: boolean; caching_observed?: boolean; hit_ratio?: number | null } | null;
}

export interface StatuslineContext {
  signals: Signals | null;
  branch: string | null;
  baselines: Baseline[];
}

// Below this many sessions a "median" is noise; fall back to a plain absolute
// threshold for the prompt warning and show no comparison at all for cost.
const MIN_BASELINE_SESSIONS = 5;
const ABSOLUTE_PROMPT_WARNING = 15;

const money = (usd: number) => `$${usd.toFixed(2)}`;

/**
 * One line, no I/O: everything is passed in. Segments with no data are
 * dropped rather than shown as zeros.
 */
export function renderStatusline(input: StatuslineInput, context: StatuslineContext): string {
  const taskType = deriveTaskType(context.branch);
  const baseline = context.baselines.find(
    (b) => b.taskType === taskType && b.n >= MIN_BASELINE_SESSIONS
  );
  const segments: string[] = [];

  const ctx = input.context_window?.used_percentage;
  if (typeof ctx === "number") {
    segments.push(`ctx ${Math.round(ctx)}%${ctx >= 80 ? " !" : ""}`);
  }

  const cache = input.prompt_cache;
  if (cache?.caching_observed) {
    if (cache.warm === false) {
      segments.push("cache COLD");
    } else if (typeof cache.hit_ratio === "number") {
      segments.push(`cache ${Math.round(cache.hit_ratio * 100)}%`);
    }
  }

  const prompts = context.signals?.promptCount;
  if (typeof prompts === "number") {
    const commits = context.signals?.commitCount ?? 0;
    const medianPrompts = baseline?.medianPrompts ?? null;
    const limit = medianPrompts !== null ? Math.max(medianPrompts * 2, 8) : ABSOLUTE_PROMPT_WARNING;
    let text = `${prompts} prompt${prompts === 1 ? "" : "s"}`;
    if (commits > 0) text += `, ${commits} commit${commits === 1 ? "" : "s"}`;
    if (medianPrompts !== null) text += ` (med ${Math.round(medianPrompts)})`;
    if (commits === 0 && prompts >= limit) text += " no commit yet !";
    segments.push(text);
  }

  const cost = input.cost?.total_cost_usd;
  if (typeof cost === "number") {
    let text = money(cost);
    const medianCost = baseline?.medianCostUsd ?? null;
    if (medianCost !== null) {
      text += ` (med ${taskType} ${money(medianCost)})${cost > medianCost * 2 ? " !" : ""}`;
    }
    segments.push(text);
  }

  return segments.join(" | ");
}
