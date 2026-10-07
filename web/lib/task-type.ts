// Pure module (no imports) so it can be unit-tested with plain `node --test`.

export const TASK_TYPES = ["bugfix", "feature", "refactor", "chore", "docs", "test", "other"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  bugfix: "Bugfix",
  feature: "Feature",
  refactor: "Refactor",
  chore: "Chore",
  docs: "Docs",
  test: "Test",
  other: "Other",
};

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === "string" && (TASK_TYPES as readonly string[]).includes(value);
}

// First path segment of the branch -> task type. `feature` is accepted
// alongside `feat` because this repo's own convention uses `feature/…`.
const PREFIXES: Record<string, TaskType> = {
  fix: "bugfix",
  bugfix: "bugfix",
  hotfix: "bugfix",
  feat: "feature",
  feature: "feature",
  refactor: "refactor",
  chore: "chore",
  docs: "docs",
  doc: "docs",
  test: "test",
  tests: "test",
};

/** Task type implied by a git branch prefix (`fix/…`, `feat/…`); `other` when unrecognized or no branch. */
export function deriveTaskType(branch: string | null | undefined): TaskType {
  if (!branch) return "other";
  const prefix = branch.split("/")[0]?.toLowerCase();
  if (!prefix || prefix === branch.toLowerCase()) return "other";
  return PREFIXES[prefix] ?? "other";
}

/** The task type to display/aggregate: the stored one, else derived on the fly from the branch (read-only — nothing is backfilled). */
export function effectiveTaskType(session: {
  taskType: string | null;
  gitBranch: string | null;
}): TaskType {
  return isTaskType(session.taskType) ? session.taskType : deriveTaskType(session.gitBranch);
}
