import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR, type DevMeterConfig } from "./config.ts";
import { fetchBaselines, type Baseline } from "./api-client.ts";

const BASELINES_PATH = join(CONFIG_DIR, "baselines.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface BaselinesFile {
  fetchedAt: string;
  baselines: Baseline[];
}

export function readBaselines(): Baseline[] {
  if (!existsSync(BASELINES_PATH)) return [];
  try {
    return (JSON.parse(readFileSync(BASELINES_PATH, "utf-8")) as BaselinesFile).baselines ?? [];
  } catch {
    return [];
  }
}

function isFresh(): boolean {
  if (!existsSync(BASELINES_PATH)) return false;
  try {
    const { fetchedAt } = JSON.parse(readFileSync(BASELINES_PATH, "utf-8")) as BaselinesFile;
    return Date.now() - new Date(fetchedAt).getTime() < MAX_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * Refreshes the per-task-type medians used by `devmeter statusline`, at most
 * once a day. Called at launch and never awaited: the statusline itself must
 * not touch the network (a slow script stalls Claude Code's UI), so it only
 * ever reads this file. Failures are silent — stale or missing baselines just
 * mean the statusline shows fewer comparisons.
 */
export function refreshBaselines(config: DevMeterConfig): void {
  if (isFresh()) return;
  fetchBaselines(config)
    .then((baselines) => {
      mkdirSync(CONFIG_DIR, { recursive: true });
      const file: BaselinesFile = { fetchedAt: new Date().toISOString(), baselines };
      writeFileSync(BASELINES_PATH, JSON.stringify(file), "utf-8");
    })
    .catch(() => {});
}
