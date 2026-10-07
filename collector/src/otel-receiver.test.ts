import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

// Replays OTLP/JSON payloads shaped like Claude Code's real export through a
// real receiver on an ephemeral port, then checks what the tracker POSTs.

const str = (key: string, value: string) => ({ key, value: { stringValue: value } });

function metricsPayload(metrics: unknown[]) {
  return { resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [{ metrics }] }] };
}

function counter(name: string, points: { attrs?: ReturnType<typeof str>[]; value: number }[]) {
  return {
    name,
    sum: {
      dataPoints: points.map((p) => ({ attributes: p.attrs ?? [], asInt: String(p.value) })),
    },
  };
}

function logsPayload(records: { attributes: unknown[] }[]) {
  return { resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [{ logRecords: records }] }] };
}

async function post(port: number, path: string, body: unknown): Promise<number> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function replay(run: (port: number) => Promise<void>): Promise<Record<string, unknown>[]> {
  const fakeHome = mkdtempSync(join(tmpdir(), "devmeter-test-"));
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;

  const posted: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url).startsWith("http://example.invalid")) {
      posted.push(JSON.parse((init as RequestInit).body as string));
      return new Response("{}", { status: 201 });
    }
    return originalFetch(url, init);
  }) as typeof fetch;

  const { SessionTracker } = await import("./session-tracker.ts");
  const { startOtelReceiver } = await import("./otel-receiver.ts");
  const tracker = new SessionTracker({ apiKey: "k", apiUrl: "http://example.invalid" }, fakeHome);
  const server = startOtelReceiver(() => tracker, fakeHome, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run((server.address() as AddressInfo).port);
    await tracker.finalize();
  } finally {
    server.close();
    globalThis.fetch = originalFetch;
  }
  return posted;
}

const tokenMetric = counter("claude_code.token.usage", [
  { attrs: [str("type", "input"), str("model", "claude-sonnet-4-5")], value: 100 },
  { attrs: [str("type", "cacheRead"), str("model", "claude-sonnet-4-5")], value: 700 },
  { attrs: [str("type", "cacheCreation"), str("model", "claude-sonnet-4-5")], value: 200 },
  { attrs: [str("type", "output"), str("model", "claude-sonnet-4-5")], value: 50 },
]);

test("metrics + logs replay: counters are summed and sent with the session", async () => {
  const posted = await replay(async (port) => {
    await post(
      port,
      "/v1/metrics",
      metricsPayload([
        tokenMetric,
        counter("claude_code.lines_of_code.count", [
          { attrs: [str("type", "added")], value: 40 },
          { attrs: [str("type", "removed")], value: 7 },
        ]),
        counter("claude_code.commit.count", [{ value: 2 }]),
        counter("claude_code.pull_request.count", [{ value: 1 }]),
        counter("claude_code.code_edit_tool.decision", [
          { attrs: [str("decision", "accept"), str("tool_name", "Edit")], value: 5 },
          { attrs: [str("decision", "reject"), str("tool_name", "Write")], value: 2 },
        ]),
      ])
    );
    // a second delta batch accumulates onto the first
    await post(port, "/v1/metrics", metricsPayload([counter("claude_code.commit.count", [{ value: 1 }])]));
    await post(
      port,
      "/v1/logs",
      logsPayload([
        { attributes: [str("event.name", "user_prompt"), { key: "prompt_length", value: { intValue: "12" } }] },
        { attributes: [str("event.name", "claude_code.user_prompt")] },
        { attributes: [str("event.name", "tool_result"), str("success", "true")] },
        { attributes: [str("event.name", "tool_result"), str("success", "true")] },
        { attributes: [str("event.name", "tool_result"), { key: "success", value: { boolValue: false } }] },
        { attributes: [str("event.name", "tool_result"), str("success", "false")] },
        { attributes: [str("event.name", "api_request")] },
      ])
    );
  });

  assert.equal(posted.length, 1);
  const body = posted[0];
  assert.equal(body.promptCount, 2);
  assert.equal(body.toolCalls, 4);
  assert.equal(body.toolErrors, 2);
  assert.equal(body.linesAdded, 40);
  assert.equal(body.linesRemoved, 7);
  assert.equal(body.commitCount, 3);
  assert.equal(body.prCount, 1);
  assert.equal(body.editAccepted, 5);
  assert.equal(body.editRejected, 2);
  assert.equal(body.tokensInput, 100);
  assert.equal(body.tokensCacheRead, 700);
  assert.equal(body.tokensCacheCreation, 200);
});

test("a session with only token metrics (logs not exported) omits the new fields instead of sending 0", async () => {
  const posted = await replay(async (port) => {
    await post(port, "/v1/metrics", metricsPayload([tokenMetric]));
  });
  assert.equal(posted.length, 1);
  for (const key of ["promptCount", "toolCalls", "toolErrors", "linesAdded", "commitCount", "editAccepted"]) {
    assert.equal(key in posted[0], false, `${key} should be omitted`);
  }
});

test("tool calls that all succeed report toolErrors as 0, not omitted", async () => {
  const posted = await replay(async (port) => {
    await post(port, "/v1/metrics", metricsPayload([tokenMetric]));
    await post(
      port,
      "/v1/logs",
      logsPayload([{ attributes: [str("event.name", "tool_result"), str("success", "true")] }])
    );
  });
  assert.equal(posted[0].toolCalls, 1);
  assert.equal(posted[0].toolErrors, 0);
});

test("prompt and tool content attributes are never forwarded", async () => {
  const posted = await replay(async (port) => {
    await post(port, "/v1/metrics", metricsPayload([tokenMetric]));
    await post(
      port,
      "/v1/logs",
      logsPayload([
        { attributes: [str("event.name", "user_prompt"), str("prompt", "SECRET PROMPT TEXT")] },
        {
          attributes: [
            str("event.name", "tool_result"),
            str("success", "true"),
            str("tool_parameters", "SECRET TOOL PARAMS"),
            str("tool_input", "SECRET TOOL INPUT"),
          ],
        },
      ])
    );
  });
  assert.ok(!JSON.stringify(posted).includes("SECRET"));
});

test("malformed log payloads don't crash the receiver", async () => {
  const posted = await replay(async (port) => {
    await post(port, "/v1/metrics", metricsPayload([tokenMetric]));
    const res = await fetch(`http://localhost:${port}/v1/logs`, { method: "POST", body: "not json" });
    assert.equal(res.status, 200);
    assert.equal(await post(port, "/v1/logs", { resourceLogs: [{}] }), 200);
  });
  assert.equal(posted.length, 1);
});
