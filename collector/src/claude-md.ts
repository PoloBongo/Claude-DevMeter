import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ClaudeMdInfo {
  /** First 12 hex chars of the SHA-256 of the normalized file — identifies a version without revealing content. */
  hash: string;
  lines: number;
}

/**
 * Fingerprint of the project's CLAUDE.md, so sessions can later be grouped by
 * which version of it was in force. Only the hash and line count ever leave
 * the machine, never the text. Line endings and trailing whitespace are
 * normalized so a CRLF checkout on Windows hashes like the LF one on Linux.
 * Returns null when the project has no CLAUDE.md.
 */
export function computeClaudeMdInfo(cwd: string): ClaudeMdInfo | null {
  let raw: string;
  try {
    raw = readFileSync(join(cwd, "CLAUDE.md"), "utf-8");
  } catch {
    return null;
  }
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  return {
    hash: createHash("sha256").update(normalized).digest("hex").slice(0, 12),
    lines: normalized === "" ? 0 : normalized.split("\n").length,
  };
}
