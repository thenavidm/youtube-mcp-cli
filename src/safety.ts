/**
 * Decides whether a write is allowed to reach YouTube.
 *
 * The hazard here is not symmetrical, so the guarding is not either. Editing a
 * title is a keystroke to put back. Deleting a video is final: YouTube removes
 * it immediately, there is no trash, and the view count, the comments and the
 * URL are gone with it. A public comment is visible the moment it lands and a
 * later delete does not unsend the notification it already produced.
 *
 * So: everything works, and only the operations that reach other people or
 * cannot be undone need an explicit `confirm: true` that the model sets after
 * reading a description saying why. Title edits, description edits and privacy
 * changes are not guarded, because confirming those too would train the model
 * to pass confirm reflexively, which is worse protection than none.
 *
 * YOUTUBE_READ_ONLY=1 removes every write from the tool list entirely, which is
 * the setting to use when pointing an untrusted agent at a real channel.
 */

import { appendFileSync } from "node:fs";
import type { Config } from "./config.js";

export class WriteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteBlockedError";
  }
}

export type Risk =
  /** Reads public data, or your own. */
  | "read"
  /** Changes something you can put back: a title, a description, a privacy flag. */
  | "write"
  /** Public the moment it runs, or gone for good. */
  | "destructive";

/** Which surface a call came through, so a refusal names the right way to confirm. */
export type GuardSurface = "mcp" | "cli";

export class WriteGuard {
  constructor(
    private readonly config: Config,
    private readonly surface: GuardSurface = "mcp",
  ) {}

  get readOnly(): boolean {
    return this.config.readOnly;
  }

  check(tool: string, risk: Risk, confirm: boolean | undefined, summary: string): void {
    if (risk === "read") return;

    if (this.config.readOnly) {
      this.audit(tool, summary, "blocked: read-only");
      throw new WriteBlockedError(
        `${tool} is unavailable: this server is running with YOUTUBE_READ_ONLY=1.`,
      );
    }

    if (risk === "destructive") {
      if (!this.config.allowDestructive) {
        this.audit(tool, summary, "blocked: destructive disabled");
        throw new WriteBlockedError(
          `${tool} is unavailable: this server is running with YOUTUBE_ALLOW_DESTRUCTIVE=0.`,
        );
      }
      if (confirm !== true) {
        this.audit(tool, summary, "blocked: no confirm");
        const how = this.surface === "cli" ? "--confirm" : "confirm: true";
        throw new WriteBlockedError(
          `${tool} is public or irreversible, so it will not run without ${how}. About to: ${summary}. Run it again with ${how} if that is what was asked for.`,
        );
      }
    }

    this.audit(tool, summary, "allowed");
  }

  /** Append-only record of every attempted write, when YOUTUBE_AUDIT_LOG is set. */
  private audit(tool: string, summary: string, outcome: string): void {
    if (!this.config.auditPath) return;
    const line = JSON.stringify({ at: new Date().toISOString(), tool, summary, outcome });
    try {
      appendFileSync(this.config.auditPath, `${line}\n`, { mode: 0o600 });
    } catch {
      // A failing audit log must never take the tool call down with it.
    }
  }
}

/**
 * MCP annotations for a risk level.
 *
 * Clients read these to decide what to auto-approve, so they have to be honest.
 * `openWorldHint` is true throughout because every call leaves the machine, and
 * `idempotentHint` is false for a reply because calling it twice replies twice.
 */
export function annotationsFor(
  risk: Risk,
  options: { idempotent?: boolean } = {},
): Record<string, boolean> {
  return {
    readOnlyHint: risk === "read",
    destructiveHint: risk === "destructive",
    idempotentHint: options.idempotent ?? risk === "read",
    openWorldHint: true,
  };
}
