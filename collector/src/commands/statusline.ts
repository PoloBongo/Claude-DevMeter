import { getCurrentBranch } from "../git.ts";
import { readBaselines } from "../baselines.ts";
import { findStatusEntry } from "../status-store.ts";
import { renderStatusline, type StatuslineInput } from "../statusline.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * `devmeter statusline` — configured as Claude Code's `statusLine` command.
 * Reads the session JSON on stdin and prints one line. No network, never
 * throws: a broken statusline must not get in the way of the session, so any
 * failure just prints nothing.
 */
export async function statuslineCommand(): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as StatuslineInput;
    const cwd = input.cwd ?? process.cwd();
    const entry = findStatusEntry(cwd);
    const line = renderStatusline(input, {
      signals: entry?.signals ?? null,
      branch: entry?.gitBranch ?? getCurrentBranch(cwd),
      baselines: readBaselines(),
    });
    if (line) console.log(line);
  } catch {
    // intentionally silent
  }
}
