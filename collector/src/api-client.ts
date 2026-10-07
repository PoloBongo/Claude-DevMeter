import type { DevMeterConfig } from "./config.ts";
import type { ModelBreakdown } from "./session-tracker.ts";

export interface IngestPayload {
  clientSessionId: string;
  projectName: string;
  clientName?: string;
  gitBranch?: string;
  ticketRef?: string;
  startedAt: string;
  endedAt: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  estimatedCostUsd: number;
  modelBreakdown: ModelBreakdown;
  // Friction / outcome counters. Each is omitted until Claude Code actually
  // reported that signal, so "unknown" never gets sent as a misleading 0.
  promptCount?: number;
  editAccepted?: number;
  editRejected?: number;
  toolCalls?: number;
  toolErrors?: number;
  linesAdded?: number;
  linesRemoved?: number;
  commitCount?: number;
  prCount?: number;
  compactionCount?: number;
  apiErrorCount?: number;
  planModeCount?: number;
  subagentRuns?: number;
  skillActivations?: number;
  /** Largest main-conversation context seen: input + cache read + cache creation tokens of one request. */
  peakContextTokens?: number;
  /** Most-used reasoning effort across the session's main requests. */
  effort?: string;
  claudeCodeVersion?: string;
  claudeMdHash?: string;
  claudeMdLines?: number;
  /** The user's answer to Claude Code's "How is Claude doing?" survey, as reported. */
  surveyResponse?: string;
}

export interface Baseline {
  taskType: string;
  n: number;
  medianCostUsd: number | null;
  medianPrompts: number | null;
}

export async function fetchBaselines(config: DevMeterConfig): Promise<Baseline[]> {
  const res = await fetch(`${config.apiUrl}/api/baselines`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Baselines fetch failed (${res.status})`);
  const body = (await res.json()) as { baselines?: Baseline[] };
  return body.baselines ?? [];
}

export async function sendSession(
  config: DevMeterConfig,
  payload: IngestPayload
): Promise<void> {
  const res = await fetch(`${config.apiUrl}/api/sessions/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ingest failed (${res.status}): ${body}`);
  }
}
