/**
 * The two surfaces, now that Slipway builds both from ALL_TOOLS.
 *
 * Parsing, help and the exit-code contract are Slipway's and tested there. What
 * matters here: every tool arrives on both surfaces intact, the two
 * irreversible tools still ask first, 2.0's `auth` and `logout` still work,
 * Google's errors keep their exit codes, and the docs stay in step with the code.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT } from "@thenavidm/slipway";
import { checkApp, cli, connect } from "@thenavidm/slipway/testing";
import { app } from "../src/app.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { toSlipway } from "../src/tools/kit.js";
import { YouTubeApiError } from "../src/youtube/api.js";
import { TranscriptError } from "../src/youtube/transcripts.js";

/** Nothing here may read a real saved login. */
const env = { YOUTUBE_MCP_HOME: mkdtempSync(join(tmpdir(), "youtube-home-")) };

describe("YouTube on Slipway", () => {
  it("offers every tool as a command and over MCP, under the same names", async () => {
    const list = await cli(app, [], { env });
    for (const tool of ALL_TOOLS) expect(list.stdout).toContain(tool.command);
    const mcp = await connect(app, { env });
    const names = (await mcp.listTools()).map((tool) => tool.name).sort();
    await mcp.close();
    expect(names).toEqual(ALL_TOOLS.map((tool) => tool.name).sort());
  });

  it("refuses to delete a video without --confirm, before anything reaches YouTube", async () => {
    const run = await cli(app, ["delete-video", "--video-id", "abc"], { env });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr).code).toBe("refused");
    expect(run.stderr).toContain("permanently delete video abc");
  });

  it("asks for approval on the two irreversible tools and on no other", async () => {
    const mcp = await connect(app, { env });
    const tools = await mcp.listTools();
    await mcp.close();
    const confirming = tools.filter((tool) => "confirm" in ((tool.inputSchema as { properties?: object }).properties ?? {})).map((tool) => tool.name);
    expect(confirming.sort()).toEqual(["delete_video", "reply_to_comment"]);
  });

  it("hides every write when YOUTUBE_READ_ONLY is set", async () => {
    const mcp = await connect(app, { env: { ...env, YOUTUBE_READ_ONLY: "1" } });
    const tools = await mcp.listTools();
    await mcp.close();
    expect(tools.length).toBe(ALL_TOOLS.filter((tool) => tool.risk === "read").length);
  });

  it("keeps 2.0's auth and logout, and logout names what to pass", async () => {
    expect((await cli(app, ["--help"], { env })).stdout).toContain("youtube-cli logout <channel> | logout --api-key");
    expect((await cli(app, ["auth", "--help"], { env })).stdout).toContain("Usage: youtube-cli auth [--api-key KEY]");
    expect((await cli(app, ["--help"], { env })).stdout).not.toContain("youtube-cli auth");
    expect((await cli(app, ["logout"], { env })).code).toBe(2);
  });

  it("passes slipway check", async () => {
    const report = await checkApp(app, { env });
    expect(report.findings.filter((finding) => finding.level === "error")).toEqual([]);
  });
});

describe("Google's errors keep their exit codes", () => {
  it.each([
    ["a used-up quota, sent as a 403", new YouTubeApiError("Daily API quota is used up.", 403, "quotaExceeded"), EXIT.rateLimited],
    ["a per-user rate limit, sent as a 403", new YouTubeApiError("User rate limit exceeded.", 403, "userRateLimitExceeded"), EXIT.rateLimited],
    ["a missing scope", new YouTubeApiError("Your token lacks the scope.", 403, "insufficientPermissions"), EXIT.auth],
    ["an expired token", new YouTubeApiError("The access token is invalid or expired.", 401, "authError"), EXIT.auth],
    ["a missing video", new YouTubeApiError("Not found. Check the id.", 404, "videoNotFound"), EXIT.notFound],
    ["a bad argument", new YouTubeApiError("Invalid value.", 400, "invalidParameter"), EXIT.usage],
    ["a video with no captions", new TranscriptError("This video has no captions.", "no_captions"), EXIT.notFound],
    ["a blocked transcript fetch", new TranscriptError("YouTube blocked the request.", "blocked"), EXIT.api],
    ["YouTube rate limiting transcripts from this IP", new TranscriptError("YouTube is rate limiting transcript requests from this IP.", "rate_limited"), EXIT.rateLimited],
    ["yt-dlp not installed", new TranscriptError("yt-dlp is not installed.", "no_ytdlp"), EXIT.notConfigured],
    ["yt-dlp failing", new Error("yt-dlp failed: unknown error"), EXIT.api],
    ["nothing configured", new Error("No API key is configured. Run `youtube-cli login --api-key KEY`."), EXIT.notConfigured],
  ])("%s", (_name, raw, code) => {
    expect((toSlipway(raw) as { exitCode: number }).exitCode).toBe(code);
  });

  it("leaves a bug in this code as unexpected", () => {
    expect(toSlipway(new TypeError("x is undefined"))).toBeInstanceOf(TypeError);
  });
});

describe("documentation stays in step with the code", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf-8");
  const names = (text: string): Set<string> => new Set((text.match(/YOUTUBE_[A-Z_]+/g) ?? []).filter((name) => !name.endsWith("_")));
  const source = (dir: string): string =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? source(`${dir}${entry.name}/`) : entry.name.endsWith(".ts") ? read(`${dir}${entry.name}`) : ""))
      .join("\n");

  /** Every variable the server reads: this repo's code, and Slipway's as agent-context lists them. */
  const used = async (): Promise<Set<string>> => {
    const context = JSON.parse((await cli(app, ["agent-context"], { env })).stdout);
    return new Set([...names(source("../src/")), ...context.settings.map((setting: { env: string }) => setting.env)]);
  };

  it("documents every environment variable the code reads", async () => {
    const documented = names(read("../README.md"));
    expect([...(await used())].filter((v) => !documented.has(v))).toEqual([]);
  });

  it("lists every environment variable in --help", async () => {
    const help = (await cli(app, ["--help"], { env })).stdout;
    // The help groups the HTTP ones as `YOUTUBE_HTTP_PORT / _HOST / _TOKEN / _ALLOWED_ORIGINS`.
    const shorthand = new Set(["YOUTUBE_HTTP_HOST", "YOUTUBE_HTTP_TOKEN", "YOUTUBE_HTTP_ALLOWED_ORIGINS"]);
    expect([...(await used())].filter((v) => !help.includes(v) && !shorthand.has(v))).toEqual([]);
  });

  it.each(["../README.md", "../INSTALL.md"])("has no dead in-page anchors in %s", (file) => {
    if (!existsSync(new URL(file, import.meta.url))) return; // repo may ship one doc
    const md = read(file).replace(/```[\s\S]*?```/g, "");
    // GitHub's slug keeps letters, marks, numbers and connector punctuation, so an
    // emoji's variation selector (U+FE0F) stays in the anchor and a link has to carry it.
    const slugs = new Set(
      [...md.matchAll(/^#{1,6} (.+)$/gm)].map(([, heading]) =>
        (heading as string).trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, "").replace(/ /g, "-"),
      ),
    );
    const dead = [...md.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)]
      .map((m) => decodeURIComponent(m[1] as string))
      .filter((a) => !slugs.has(a));
    expect(dead).toEqual([]);
  });
});
