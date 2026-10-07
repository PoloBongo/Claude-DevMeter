import { createServer, type Server } from "node:http";
import type { SessionTracker } from "./session-tracker.ts";

const TOKEN_METRIC_NAME = "claude_code.token.usage";
const LINES_METRIC_NAME = "claude_code.lines_of_code.count";
const COMMIT_METRIC_NAME = "claude_code.commit.count";
const PR_METRIC_NAME = "claude_code.pull_request.count";
const EDIT_DECISION_METRIC_NAME = "claude_code.code_edit_tool.decision";
const CWD_RESOURCE_ATTRIBUTE = "devmeter.cwd";
const DEFAULT_PORT = 4318;

interface AttributeValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
}

interface Attribute {
  key: string;
  value?: AttributeValue;
}

interface DataPoint {
  attributes?: Attribute[];
  asInt?: string | number;
  asDouble?: number;
}

interface Metric {
  name: string;
  sum?: { dataPoints?: DataPoint[] };
  gauge?: { dataPoints?: DataPoint[] };
}

interface ScopeMetrics {
  metrics?: Metric[];
}

interface Resource {
  attributes?: Attribute[];
}

interface ResourceMetrics {
  resource?: Resource;
  scopeMetrics?: ScopeMetrics[];
}

interface OtlpMetricsPayload {
  resourceMetrics?: ResourceMetrics[];
}

/**
 * Claude Code documents `success` as the string "true"/"false", but OTLP/JSON
 * encodes typed attributes separately (boolValue, intValue) — normalize all
 * of them to a string so callers don't care which encoding arrived.
 */
function findAttribute(attributes: Attribute[] | undefined, key: string): string | null {
  const value = attributes?.find((a) => a.key === key)?.value;
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return String(value.boolValue);
  if (value.intValue !== undefined) return String(value.intValue);
  return null;
}

interface LogRecord {
  attributes?: Attribute[];
  body?: AttributeValue;
}

interface ScopeLogs {
  logRecords?: LogRecord[];
}

interface ResourceLogs {
  resource?: Resource;
  scopeLogs?: ScopeLogs[];
}

interface OtlpLogsPayload {
  resourceLogs?: ResourceLogs[];
}

function dataPointValue(dataPoint: DataPoint): number {
  if (typeof dataPoint.asDouble === "number") return dataPoint.asDouble;
  if (dataPoint.asInt !== undefined) return Number(dataPoint.asInt);
  return 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Claude Code's `claude_code.token.usage` metric reports 4 distinct token
 * kinds via the `type` attribute: `input`, `output`, `cacheRead`,
 * `cacheCreation`. Cache reads in particular happen on nearly every turn
 * (the full context is re-sent from cache) and are billed at ~10% of the
 * input rate — lumping them into `input` both wildly inflates the token
 * count shown to the user and overstates cost, since they'd be priced at
 * full input rate. Any unrecognized type falls back to `input` so nothing
 * is silently dropped if Claude Code adds a new kind.
 */
function handleTokenMetric(metric: Metric, tracker: SessionTracker): void {
  const dataPoints = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
  for (const dataPoint of dataPoints) {
    const model = findAttribute(dataPoint.attributes, "model") ?? "unknown";
    const type = findAttribute(dataPoint.attributes, "type");
    const value = dataPointValue(dataPoint);
    if (value <= 0) continue;

    switch (type) {
      case "output":
        tracker.addTokens(model, "output", value);
        break;
      case "cacheRead":
        tracker.addTokens(model, "cacheRead", value);
        break;
      case "cacheCreation":
        tracker.addTokens(model, "cacheCreation", value);
        break;
      default:
        tracker.addTokens(model, "input", value);
        break;
    }
  }
}

/** Sum of all data points of a counter metric, optionally only those matching `accept`. */
function sumDataPoints(metric: Metric, accept?: (dataPoint: DataPoint) => boolean): number {
  const dataPoints = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
  let total = 0;
  for (const dataPoint of dataPoints) {
    if (accept && !accept(dataPoint)) continue;
    const value = dataPointValue(dataPoint);
    if (value > 0) total += value;
  }
  return total;
}

/**
 * Friction / outcome counters from Claude Code's metrics. Each call records
 * the signal even when the delta is 0 for that kind — receiving the metric
 * at all means Claude Code reports it, so "0" is a real value from then on.
 * Counts only; no content is available on these metrics anyway.
 */
function handleSignalMetric(metric: Metric, tracker: SessionTracker): void {
  switch (metric.name) {
    case LINES_METRIC_NAME:
      tracker.addSignal(
        "linesAdded",
        sumDataPoints(metric, (d) => findAttribute(d.attributes, "type") === "added")
      );
      tracker.addSignal(
        "linesRemoved",
        sumDataPoints(metric, (d) => findAttribute(d.attributes, "type") === "removed")
      );
      break;
    case COMMIT_METRIC_NAME:
      tracker.addSignal("commitCount", sumDataPoints(metric));
      break;
    case PR_METRIC_NAME:
      tracker.addSignal("prCount", sumDataPoints(metric));
      break;
    case EDIT_DECISION_METRIC_NAME:
      tracker.addSignal(
        "editAccepted",
        sumDataPoints(metric, (d) => findAttribute(d.attributes, "decision") === "accept")
      );
      tracker.addSignal(
        "editRejected",
        sumDataPoints(metric, (d) => findAttribute(d.attributes, "decision") === "reject")
      );
      break;
  }
}

/** Event names arrive as `user_prompt` in the attribute but are documented as `claude_code.user_prompt`; accept both. */
function eventName(record: LogRecord): string | null {
  const raw = findAttribute(record.attributes, "event.name") ?? record.body?.stringValue ?? null;
  return raw ? raw.replace(/^claude_code\./, "") : null;
}

/**
 * Counts prompts and tool calls from OTLP log events. Only `event.name` and
 * `success` are ever read — never `prompt`, `tool_parameters`, `tool_input`
 * or any other content attribute, so even if a user has enabled content
 * logging elsewhere nothing of it is stored.
 */
function handleLogRecord(record: LogRecord, tracker: SessionTracker): void {
  switch (eventName(record)) {
    case "user_prompt":
      tracker.addSignal("promptCount", 1);
      break;
    case "tool_result":
      tracker.addSignal("toolCalls", 1);
      tracker.addSignal("toolErrors", findAttribute(record.attributes, "success") === "false" ? 1 : 0);
      break;
  }
}

function resolveCwd(resource: Resource | undefined, fallbackCwd: string): string {
  const cwd = findAttribute(resource?.attributes, CWD_RESOURCE_ATTRIBUTE) ?? fallbackCwd;
  if (process.env.DEVMETER_DEBUG) {
    console.log(
      "[devmeter debug] resource.attributes:",
      JSON.stringify(resource?.attributes),
      "-> resolved cwd:",
      cwd
    );
  }
  return cwd;
}

export function ingestMetrics(
  body: OtlpMetricsPayload,
  getTracker: (cwd: string) => SessionTracker,
  fallbackCwd: string
): void {
  for (const resourceMetrics of body.resourceMetrics ?? []) {
    const tracker = getTracker(resolveCwd(resourceMetrics.resource, fallbackCwd));
    for (const scopeMetrics of resourceMetrics.scopeMetrics ?? []) {
      for (const metric of scopeMetrics.metrics ?? []) {
        if (metric.name === TOKEN_METRIC_NAME) {
          handleTokenMetric(metric, tracker);
        } else {
          handleSignalMetric(metric, tracker);
        }
      }
    }
  }
}

export function ingestLogs(
  body: OtlpLogsPayload,
  getTracker: (cwd: string) => SessionTracker,
  fallbackCwd: string
): void {
  for (const resourceLogs of body.resourceLogs ?? []) {
    const tracker = getTracker(resolveCwd(resourceLogs.resource, fallbackCwd));
    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      for (const record of scopeLogs.logRecords ?? []) {
        handleLogRecord(record, tracker);
      }
    }
  }
}

/**
 * `getTracker` resolves which project a batch of metrics belongs to. When a
 * session was launched via `devmeter claude`, the payload's resource carries
 * a `devmeter.cwd` attribute (set via OTEL_RESOURCE_ATTRIBUTES) identifying
 * exactly where that `claude` process was running — independent of where
 * `devmeter start` itself was launched. Sessions started by hand (manually
 * exporting the OTEL_* vars) carry no such attribute and fall back to the
 * collector's own cwd, matching the old single-project behavior.
 */
export function startOtelReceiver(
  getTracker: (cwd: string) => SessionTracker,
  fallbackCwd: string,
  port = DEFAULT_PORT
): Server {
  const server = createServer((req, res) => {
    const isMetrics = req.url?.startsWith("/v1/metrics");
    const isLogs = req.url?.startsWith("/v1/logs");
    if (req.method !== "POST" || (!isMetrics && !isLogs)) {
      res.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        if (isObject(body)) {
          if (isMetrics) {
            ingestMetrics(body as OtlpMetricsPayload, getTracker, fallbackCwd);
          } else {
            ingestLogs(body as OtlpLogsPayload, getTracker, fallbackCwd);
          }
        }
      } catch {
        // Ignore malformed payloads rather than crashing the collector.
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });

  server.listen(port);
  return server;
}
