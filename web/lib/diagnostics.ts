// Pure module (no imports) so it can be unit-tested with plain `node --test`.
//
// Session diagnostics: plain-language "why was this session expensive or
// rough?" findings computed from counters DevMeter already stores. Nothing
// here is stored; it is derived on read, so thresholds can change freely.
//
// Every rule is skipped when the data it needs is null (older session or
// collector): unknown is never treated as zero. Where the Claude Code docs
// give a number it is used as-is and cited; everything else is calibrated on
// the user's own history and marked as indicative.

const DOCS = "https://code.claude.com/docs/en";

export type DiagnosticSeverity = "warn" | "info";

export interface Diagnostic {
  id: DiagnosticId;
  severity: DiagnosticSeverity;
  title: string;
  /** What it means and what to try, in one or two sentences. */
  detail: string;
  /** The numbers that triggered it. */
  evidence: string;
  /** Link to the Claude Code documentation backing the advice. */
  docUrl: string;
}

export type DiagnosticId =
  | "claudemd-long"
  | "context-heavy"
  | "repeated-compactions"
  | "low-cache"
  | "many-prompts-no-commit"
  | "cost-outlier"
  | "rejected-edits"
  | "tool-failures"
  | "effort-on-short-session"
  | "opus-on-small-task"
  | "api-errors";

export interface DiagnosticInput {
  claudeMdLines: number | null;
  peakContextTokens: number | null;
  compactionCount: number | null;
  /** cacheRead / (input + cacheRead + cacheCreation), or null. */
  cacheRatio: number | null;
  /** input + cacheRead + cacheCreation tokens for the whole session. */
  inputSideTokens: number;
  promptCount: number | null;
  commitCount: number | null;
  editAccepted: number | null;
  editRejected: number | null;
  toolCalls: number | null;
  toolErrors: number | null;
  apiErrorCount: number | null;
  effort: string | null;
  /** linesAdded + linesRemoved, or null when neither was reported. */
  linesChanged: number | null;
  /** Share (0-1) of the session's estimated cost that went to Opus models, or null without a per-model breakdown. */
  opusCostShare: number | null;
  costUsd: number;
}

export interface DiagnosticContext {
  /** Peak-context level above which a session counts as "heavy". */
  peakContextThreshold: number;
  /** Median figures for the session's task type, when there are enough sessions to trust them. */
  baseline: { medianPrompts: number | null; medianCostUsd: number | null } | null;
}

/** Thresholds, exported so the README and tests stay in step with the code. */
export const THRESHOLDS = {
  /** Claude Code costs guide: "Aim to keep CLAUDE.md under 200 lines". */
  claudeMdLines: 200,
  /** Without enough history, a request carrying 150k+ tokens of context is flagged. Indicative. */
  defaultPeakContext: 150_000,
  /** Floor for the history-based threshold, so a user with only small sessions is not nagged about 30k contexts. */
  minPeakContext: 80_000,
  /** Sessions with at least this many peak-context samples use their own 90th percentile instead of the default. */
  minHistoryForPercentile: 10,
  compactions: 2,
  lowCacheRatio: 0.5,
  /** Below this much input-side traffic a low cache ratio is just a short session. */
  minTokensForCacheRule: 50_000,
  /** Without a median for the task type, this many prompts with no commit is flagged. */
  absolutePrompts: 15,
  minPromptsForCommitRule: 8,
  promptMedianMultiple: 2,
  costMedianMultiple: 2,
  minDecisionsForRejectRule: 5,
  rejectedEditShare: 0.3,
  minToolCallsForFailureRule: 10,
  toolFailureShare: 0.2,
  shortSessionPrompts: 3,
  smallTaskLines: 50,
  opusShare: 0.8,
  apiErrors: 3,
} as const;

const pct = (value: number) => `${Math.round(value * 100)}%`;
const k = (tokens: number) => `${Math.round(tokens / 1000)}k`;

/** 90th percentile (nearest-rank) of the finite values, or null when there are fewer than `min`. */
export function percentile90(values: (number | null | undefined)[], min = THRESHOLDS.minHistoryForPercentile): number | null {
  const sorted = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length < min) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
}

/** The peak-context level a user's sessions are compared against: their own p90 (floored) once there is history, else the default. */
export function peakContextThresholdFor(historyPeaks: (number | null | undefined)[]): number {
  const p90 = percentile90(historyPeaks);
  return p90 === null ? THRESHOLDS.defaultPeakContext : Math.max(p90, THRESHOLDS.minPeakContext);
}

export function diagnose(input: DiagnosticInput, context: DiagnosticContext): Diagnostic[] {
  const found: Diagnostic[] = [];
  const T = THRESHOLDS;

  if (input.claudeMdLines !== null && input.claudeMdLines > T.claudeMdLines) {
    found.push({
      id: "claudemd-long",
      severity: "warn",
      title: "CLAUDE.md is long",
      detail:
        "It is loaded into context at the start of every session, and a long one makes rules get lost. Move workflow-specific instructions into skills and cut what Claude can infer from the code.",
      evidence: `${input.claudeMdLines} lines (guidance: under ${T.claudeMdLines})`,
      docUrl: `${DOCS}/costs#move-instructions-from-claude-md-to-skills`,
    });
  }

  if (input.peakContextTokens !== null && input.peakContextTokens >= context.peakContextThreshold) {
    found.push({
      id: "context-heavy",
      severity: "warn",
      title: "Very large context",
      detail:
        "Every request re-sends the whole conversation, so a big context makes each later message costlier and tends to degrade answers. Use /clear between unrelated tasks, and delegate noisy exploration to subagents.",
      evidence: `peak ${k(input.peakContextTokens)} tokens in one request (flagged from ${k(context.peakContextThreshold)}, indicative)`,
      docUrl: `${DOCS}/costs#manage-context-proactively`,
    });
  }

  if (input.compactionCount !== null && input.compactionCount >= T.compactions) {
    found.push({
      id: "repeated-compactions",
      severity: "warn",
      title: "Repeated compactions",
      detail:
        "The session filled its context more than once. Compacting is itself a large request and loses detail. Split the work into separate sessions, or /clear when you switch topic.",
      evidence: `${input.compactionCount} compactions`,
      docUrl: `${DOCS}/costs#why-usage-climbs-in-a-long-session`,
    });
  }

  if (
    input.cacheRatio !== null &&
    input.cacheRatio < T.lowCacheRatio &&
    input.inputSideTokens >= T.minTokensForCacheRule
  ) {
    const compacted = (input.compactionCount ?? 0) > 0;
    found.push({
      id: "low-cache",
      severity: compacted ? "info" : "warn",
      title: "Low prompt-cache share",
      detail:
        "The cache lifetime is 1 hour on a subscription but only 5 minutes on an API key or usage credits: a longer pause makes the next message reprocess the full context. Editing CLAUDE.md or tools mid-session also invalidates it." +
        (compacted ? " Compactions rebuild the cache too, so part of this is expected." : ""),
      evidence: `${pct(input.cacheRatio)} of input tokens read from cache`,
      docUrl: `${DOCS}/costs#why-usage-climbs-in-a-long-session`,
    });
  }

  if (input.promptCount !== null && (input.commitCount ?? 0) === 0) {
    const median = context.baseline?.medianPrompts ?? null;
    const limit =
      median !== null
        ? Math.max(median * T.promptMedianMultiple, T.minPromptsForCommitRule)
        : T.absolutePrompts;
    if (input.promptCount >= limit) {
      found.push({
        id: "many-prompts-no-commit",
        severity: "warn",
        title: "Many prompts, no commit",
        detail:
          "A long back-and-forth that did not end in a commit often means the first prompt was too vague. Scope the task (files, symptom, what done looks like) and give Claude a test or check it can run.",
        evidence:
          median !== null
            ? `${input.promptCount} prompts vs a median of ${Math.round(median)} for this task type`
            : `${input.promptCount} prompts (flagged from ${T.absolutePrompts} without a baseline)`,
        docUrl: `${DOCS}/best-practices#provide-specific-context-in-your-prompts`,
      });
    }
  }

  const medianCost = context.baseline?.medianCostUsd ?? null;
  if (medianCost !== null && medianCost > 0 && input.costUsd >= medianCost * T.costMedianMultiple) {
    found.push({
      id: "cost-outlier",
      severity: "warn",
      title: "Cost well above normal",
      detail:
        "This session cost far more than your typical one for this kind of task. Check the other findings for the likely cause (context size, compactions, cache), then compare with a cheaper session.",
      evidence: `${(input.costUsd / medianCost).toFixed(1)}x the median for this task type`,
      docUrl: `${DOCS}/costs#reduce-token-usage`,
    });
  }

  const decisions = (input.editAccepted ?? 0) + (input.editRejected ?? 0);
  if (
    input.editAccepted !== null &&
    input.editRejected !== null &&
    decisions >= T.minDecisionsForRejectRule &&
    input.editRejected / decisions >= T.rejectedEditShare
  ) {
    found.push({
      id: "rejected-edits",
      severity: "warn",
      title: "Many rejected edits",
      detail:
        "You turned down a large share of Claude's edits. After two failed corrections the context is cluttered with wrong attempts: /clear and restart with a sharper prompt, or use plan mode to agree on the approach first.",
      evidence: `${input.editRejected} of ${decisions} edits rejected`,
      docUrl: `${DOCS}/best-practices#course-correct-early-and-often`,
    });
  }

  if (
    input.toolCalls !== null &&
    input.toolErrors !== null &&
    input.toolCalls >= T.minToolCallsForFailureRule &&
    input.toolErrors / input.toolCalls >= T.toolFailureShare
  ) {
    found.push({
      id: "tool-failures",
      severity: "info",
      title: "Lots of failing tool calls",
      detail:
        "Failed commands burn turns. Put the right build/test commands and environment quirks in CLAUDE.md, and check that permissions are not blocking routine commands.",
      evidence: `${input.toolErrors} of ${input.toolCalls} tool calls failed`,
      docUrl: `${DOCS}/best-practices#write-an-effective-claude-md`,
    });
  }

  if (
    input.effort !== null &&
    (input.effort === "xhigh" || input.effort === "max") &&
    input.promptCount !== null &&
    input.promptCount <= T.shortSessionPrompts
  ) {
    found.push({
      id: "effort-on-short-session",
      severity: "info",
      title: "High effort on a short session",
      detail:
        "Thinking tokens are billed as output. For simple tasks a lower effort level is cheaper and usually enough (/effort).",
      evidence: `effort ${input.effort}, ${input.promptCount} prompt${input.promptCount === 1 ? "" : "s"}`,
      docUrl: `${DOCS}/costs#adjust-extended-thinking`,
    });
  }

  if (
    input.opusCostShare !== null &&
    input.opusCostShare >= T.opusShare &&
    input.promptCount !== null &&
    input.promptCount <= T.shortSessionPrompts &&
    input.linesChanged !== null &&
    input.linesChanged < T.smallTaskLines
  ) {
    found.push({
      id: "opus-on-small-task",
      severity: "info",
      title: "Opus on a small task",
      detail:
        "Sonnet handles most coding tasks for less; the docs reserve Opus for complex architecture or multi-step reasoning. Switch with /model.",
      evidence: `${pct(input.opusCostShare)} of cost on Opus, ${input.linesChanged} lines changed`,
      docUrl: `${DOCS}/costs#choose-the-right-model`,
    });
  }

  if (input.apiErrorCount !== null && input.apiErrorCount >= T.apiErrors) {
    found.push({
      id: "api-errors",
      severity: "info",
      title: "API errors",
      detail:
        "Requests failed after retries. This is on the service side rather than your prompting, but it can explain a slow or stalled session.",
      evidence: `${input.apiErrorCount} failed requests`,
      docUrl: `${DOCS}/monitoring-usage#detect-retry-exhaustion`,
    });
  }

  return found;
}
