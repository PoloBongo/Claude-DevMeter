// Mirror of web/lib/task-type.ts#deriveTaskType (the collector can't import
// from web/). Keep the prefix table in sync with it; the web side is the one
// that stores the value, this copy only labels the live statusline.

const PREFIXES: Record<string, string> = {
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

export function deriveTaskType(branch: string | null | undefined): string {
  if (!branch) return "other";
  const prefix = branch.split("/")[0]?.toLowerCase();
  if (!prefix || prefix === branch.toLowerCase()) return "other";
  return PREFIXES[prefix] ?? "other";
}
