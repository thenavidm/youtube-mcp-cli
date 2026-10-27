/**
 * Uploading from this machine, against a fake Google: nothing here reaches the
 * network or a real channel.
 *
 * What matters: the metadata rules fail before a byte is sent, the resumable
 * protocol resumes from the Range YouTube reports after a 503, scheduling and
 * privacy decide whether the call asks first, the file's own header says
 * whether it becomes a Short, and a refused thumbnail never fails an upload
 * that worked.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT } from "@thenavidm/slipway";
import { cli, connect } from "@thenavidm/slipway/testing";
import { app } from "../src/app.js";
import { checkDetails, localPath, shortsVerdict, tagsLength, uploadRisk, videoState } from "../src/tools/upload.js";
import { YouTubeClient } from "../src/youtube/api.js";
import { probeVideoBytes } from "../src/youtube/mp4.js";
import { nextOffset, uploadVideoFile } from "../src/youtube/upload.js";

const scratch = mkdtempSync(join(tmpdir(), "youtube-upload-"));
const ONE = { YOUTUBE_MCP_HOME: scratch, YOUTUBE_REFRESH_TOKEN: "refresh", YOUTUBE_CLIENT_ID: "client", YOUTUBE_CLIENT_SECRET: "secret" };

// ---------------------------------------------------------------------------
// A real MP4 header, built box by box.

const ascii = (s: string) => new TextEncoder().encode(s);
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
};
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};
const box = (type: string, ...payload: Uint8Array[]) => {
  const body = cat(...payload);
  return cat(u32(8 + body.byteLength), ascii(type), body);
};
const zeros = (n: number) => new Uint8Array(n);
const ONE16 = 0x10000;

function mp4(options: { width: number; height: number; seconds: number; turned?: boolean; moovLast?: boolean }): Uint8Array {
  const matrix = options.turned
    ? [0, ONE16, 0, -ONE16, 0, 0, 0, 0, 0x40000000]
    : [ONE16, 0, 0, 0, ONE16, 0, 0, 0, 0x40000000];
  const mvhd = box("mvhd", zeros(4), zeros(8), u32(1000), u32(Math.round(options.seconds * 1000)), zeros(80));
  const tkhd = box(
    "tkhd",
    u32(3), zeros(20), zeros(16),
    ...matrix.map(u32),
    u32(options.width * ONE16),
    u32(options.height * ONE16),
  );
  const hdlr = box("hdlr", zeros(4), zeros(4), ascii("vide"), zeros(12), zeros(1));
  const moov = box("moov", mvhd, box("trak", tkhd, box("mdia", hdlr)));
  const ftyp = box("ftyp", ascii("isom"), zeros(4), ascii("isom"));
  const mdat = box("mdat", zeros(2048));
  return options.moovLast ? cat(ftyp, mdat, moov) : cat(ftyp, moov, mdat);
}

function file(name: string, bytes: Uint8Array): string {
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return path;
}

describe("the file's own header", () => {
  it("reads a vertical video's size and length", async () => {
    expect(await probeVideoBytes(mp4({ width: 1080, height: 1920, seconds: 42 }))).toEqual({ width: 1080, height: 1920, durationSeconds: 42 });
  });

  it("turns a phone's rotated landscape frames upright", async () => {
    expect(await probeVideoBytes(mp4({ width: 1920, height: 1080, seconds: 10, turned: true }))).toMatchObject({ width: 1080, height: 1920 });
  });

  it("finds the header at the end of a file that was not made fast-start", async () => {
    expect(await probeVideoBytes(mp4({ width: 720, height: 1280, seconds: 5, moovLast: true }))).toMatchObject({ width: 720, height: 1280 });
  });

  it("gives up quietly on something that is not an MP4", async () => {
    expect(await probeVideoBytes(ascii("not a video at all, just text"))).toBeUndefined();
  });

  it("calls a vertical video up to 3 minutes a Short, and nothing else", () => {
    expect(shortsVerdict({ width: 1080, height: 1920, durationSeconds: 59 }).short).toBe(true);
    expect(shortsVerdict({ width: 1080, height: 1080, durationSeconds: 180 }).short).toBe(true);
    expect(shortsVerdict({ width: 1080, height: 1920, durationSeconds: 181 })).toMatchObject({ short: false, why: expect.stringContaining("3-minute") });
    expect(shortsVerdict({ width: 1920, height: 1080, durationSeconds: 30 })).toMatchObject({ short: false, why: expect.stringContaining("horizontal") });
    expect(shortsVerdict(undefined).short).toBeNull();
  });
});

describe("YouTube's metadata rules, before anything is sent", () => {
  it("counts an emoji as one character, as YouTube does", () => {
    expect(() => checkDetails({ title: "🎬".repeat(100) })).not.toThrow();
    expect(() => checkDetails({ title: "x".repeat(101) })).toThrow(/101 characters/);
  });

  it("refuses < and > in the title and description", () => {
    expect(() => checkDetails({ title: "a <b>" })).toThrow(/< or >/);
    expect(() => checkDetails({ title: "ok", description: "x > y" })).toThrow(/< or >/);
  });

  it("measures the description in bytes", () => {
    expect(() => checkDetails({ title: "ok", description: "é".repeat(2501) })).toThrow(/5002 bytes/);
  });

  it("counts commas between tags and quotes around a tag with a space", () => {
    expect(tagsLength(["ai", "ai tools"])).toBe(2 + 1 + 8 + 2);
    expect(() => checkDetails({ title: "ok", tags: Array.from({ length: 100 }, () => "abcd") })).not.toThrow();
    expect(() => checkDetails({ title: "ok", tags: Array.from({ length: 101 }, () => "abcd") })).toThrow(/504 characters/);
  });

  it("needs a timezone on publish_at, and a private video to schedule", () => {
    expect(() => checkDetails({ title: "ok", publish_at: "2026-11-01T15:00:00" })).toThrow(/timezone/);
    expect(() => checkDetails({ title: "ok", publish_at: "2026-11-01T15:00:00Z", privacy_status: "public" })).toThrow(/private/);
    expect(() => checkDetails({ title: "ok", publish_at: "2026-11-01T15:00:00+01:00" })).not.toThrow();
  });

  it("asks first for anything viewers will see, and not for a private draft", () => {
    expect(uploadRisk({})).toBe("write");
    expect(uploadRisk({ privacy_status: "private" })).toBe("write");
    expect(uploadRisk({ privacy_status: "unlisted" })).toBe("destructive");
    expect(uploadRisk({ privacy_status: "public" })).toBe("destructive");
    expect(uploadRisk({ publish_at: "2026-11-01T15:00:00Z" })).toBe("destructive");
  });

  it("expands ~ the way a shell would", () => {
    expect(localPath("~/clip.mp4")).toMatch(/\/clip\.mp4$/);
    expect(localPath("~/clip.mp4").startsWith("~")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A fake Google that speaks the resumable protocol.

type Seen = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function fakeGoogle(options: { failChunk?: number; thumbnail?: number } = {}) {
  const seen: Seen[] = [];
  let received = 0;
  let chunks = 0;
  let total = 0;
  const fn = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    seen.push({ url, method: init.method ?? "GET", headers, body: init.body });
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

    if (url.startsWith("https://oauth2.googleapis.com/token")) return json(200, { access_token: "access", expires_in: 3600 });
    if (url.includes("/upload/youtube/v3/videos")) {
      total = Number(headers["x-upload-content-length"]);
      return new Response(null, { status: 200, headers: { location: "https://upload.example/session/1" } });
    }
    if (url.startsWith("https://upload.example/session/1")) {
      const range = headers["content-range"] ?? "";
      if (range.startsWith("bytes */")) {
        return new Response(null, { status: 308, headers: received ? { range: `bytes=0-${received - 1}` } : {} });
      }
      chunks++;
      if (chunks === options.failChunk) return new Response("backend error", { status: 503 });
      const body = init.body as Blob;
      received += body.size;
      if (received >= total) {
        return json(201, { id: "vid123", snippet: { title: "Hello", channelTitle: "Test channel" }, status: { uploadStatus: "uploaded", privacyStatus: "private" } });
      }
      return new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
    }
    if (url.includes("/upload/youtube/v3/thumbnails/set")) {
      const status = options.thumbnail ?? 200;
      return status === 200
        ? json(200, { items: [] })
        : json(status, { error: { message: "The authenticated user doesn't have permissions to upload and set custom video thumbnails.", errors: [{ reason: "forbidden" }] } });
    }
    throw new Error(`unexpected request to ${url}`);
  });
  return { fn, seen };
}

/**
 * The app reads channels from process.env, not from the env a test hands the
 * in-process CLI, so the tests that reach a channel set it here and put it back.
 */
const saved = { ...process.env };
function useEnv(vars: Record<string, string>): void {
  for (const key of Object.keys(process.env)) if (key.startsWith("YOUTUBE_")) delete process.env[key];
  Object.assign(process.env, vars);
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("the resumable upload protocol", () => {
  const account = { id: "main", name: "Main", clientId: "c", clientSecret: "s", refreshToken: "r" };

  it("reads the next byte from YouTube's Range header", () => {
    expect(nextOffset("bytes=0-524287")).toBe(524288);
    expect(nextOffset(null)).toBe(0);
  });

  it("starts a session with the file's size and type, then sends it in ranges", async () => {
    const google = fakeGoogle();
    vi.stubGlobal("fetch", google.fn);
    const path = file("chunks.mp4", new Uint8Array(1000));
    const video = await uploadVideoFile(new YouTubeClient({ account }), {
      path,
      mimeType: "video/mp4",
      metadata: { snippet: { title: "Hello", categoryId: "22" }, status: { privacyStatus: "private", selfDeclaredMadeForKids: false } },
      notifySubscribers: false,
      chunkBytes: 256,
    });
    expect(video.id).toBe("vid123");

    const start = google.seen.find((s) => s.url.includes("/upload/youtube/v3/videos"))!;
    expect(start.url).toContain("uploadType=resumable");
    expect(start.url).toContain("part=snippet%2Cstatus");
    expect(start.url).toContain("notifySubscribers=false");
    expect(start.headers["x-upload-content-length"]).toBe("1000");
    expect(start.headers["x-upload-content-type"]).toBe("video/mp4");
    expect(start.headers.authorization).toBe("Bearer access");
    expect(JSON.parse(String(start.body))).toMatchObject({ status: { selfDeclaredMadeForKids: false } });

    const ranges = google.seen.filter((s) => s.url.startsWith("https://upload.example")).map((s) => s.headers["content-range"]);
    expect(ranges).toEqual(["bytes 0-255/1000", "bytes 256-511/1000", "bytes 512-767/1000", "bytes 768-999/1000"]);
  });

  it("asks where it stands after a 503 and resumes from there", async () => {
    const google = fakeGoogle({ failChunk: 2 });
    vi.stubGlobal("fetch", google.fn);
    const path = file("retry.mp4", new Uint8Array(600));
    const progress: number[] = [];
    const video = await uploadVideoFile(new YouTubeClient({ account }), {
      path,
      mimeType: "video/mp4",
      metadata: { snippet: { title: "Hello" }, status: { privacyStatus: "private" } },
      notifySubscribers: true,
      chunkBytes: 256,
      backoffMs: [0, 0],
      onProgress: (sent) => progress.push(sent),
    });
    expect(video.id).toBe("vid123");
    const ranges = google.seen.filter((s) => s.url.startsWith("https://upload.example")).map((s) => s.headers["content-range"]);
    expect(ranges).toEqual(["bytes 0-255/600", "bytes 256-511/600", "bytes */600", "bytes 256-511/600", "bytes 512-599/600"]);
    expect(progress.at(-1)).toBe(600);
  });
});

describe("upload_video on both surfaces", () => {
  it("refuses a public upload without --confirm, naming what YouTube does, before anything is sent", async () => {
    const google = fakeGoogle();
    vi.stubGlobal("fetch", google.fn);
    const path = file("public.mp4", mp4({ width: 1080, height: 1920, seconds: 30 }));
    const run = await cli(app, ["upload-video", "--video-path", path, "--title", "Hi", "--no-made-for-kids", "--privacy-status", "public"], { env: ONE });
    expect(run.code).toBe(EXIT.usage);
    expect(JSON.parse(run.stderr).code).toBe("refused");
    expect(run.stderr).toContain("notifies your subscribers of the newly uploaded video");
    expect(google.fn).not.toHaveBeenCalled();
  });

  it("refuses a scheduled upload without --confirm too", async () => {
    const path = file("scheduled.mp4", mp4({ width: 1080, height: 1920, seconds: 30 }));
    const run = await cli(app, ["upload-video", "--video-path", path, "--title", "Hi", "--no-made-for-kids", "--publish-at", "2030-01-01T10:00:00Z"], { env: ONE });
    expect(run.code).toBe(EXIT.usage);
    expect(run.stderr).toContain("scheduled to publish 2030-01-01T10:00:00Z");
  });

  it("needs the made-for-kids answer", async () => {
    const run = await cli(app, ["upload-video", "--video-path", "/tmp/x.mp4", "--title", "Hi"], { env: ONE });
    expect(run.code).toBe(EXIT.usage);
    expect(run.stderr).toContain("made-for-kids");
  });

  it("uploads a private Short with no confirmation, and keeps the video when the thumbnail is refused", async () => {
    useEnv(ONE);
    const google = fakeGoogle({ thumbnail: 403 });
    vi.stubGlobal("fetch", google.fn);
    const video = file("short.mp4", mp4({ width: 1080, height: 1920, seconds: 42 }));
    const thumb = file("thumb.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const run = await cli(app, ["upload-video", "--video-path", video, "--title", "Hello", "--no-made-for-kids", "--thumbnail-path", thumb, "--json"], { env: ONE });
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout);
    expect(out.done).toBe(true);
    expect(out.result).toMatchObject({
      video_id: "vid123",
      privacy_status: "private",
      short: true,
      width: 1080,
      height: 1920,
      thumbnail: { set: false, error: expect.stringContaining("custom video thumbnails") },
    });
  });

  it("schedules with publishAt and a private status", async () => {
    useEnv(ONE);
    const google = fakeGoogle();
    vi.stubGlobal("fetch", google.fn);
    const video = file("later.mp4", mp4({ width: 1080, height: 1920, seconds: 20 }));
    const run = await cli(app, ["upload-video", "--video-path", video, "--title", "Later", "--no-made-for-kids", "--publish-at", "2030-01-01T10:00:00+01:00", "--confirm", "--json"], { env: ONE });
    expect(run.code).toBe(0);
    const start = google.seen.find((s) => s.url.includes("/upload/youtube/v3/videos"))!;
    expect(JSON.parse(String(start.body)).status).toMatchObject({ privacyStatus: "private", publishAt: "2030-01-01T09:00:00.000Z" });
    expect(JSON.parse(run.stdout).result).toMatchObject({ scheduled: true, publish_at: "2030-01-01T09:00:00.000Z" });
  });

  it("refuses to guess between several channels", async () => {
    const accounts = JSON.stringify([{ name: "Main", refresh_token: "a" }, { name: "Clips", refresh_token: "b" }]);
    useEnv({ YOUTUBE_MCP_HOME: scratch, YOUTUBE_ACCOUNTS: accounts });
    const video = file("two.mp4", mp4({ width: 1080, height: 1920, seconds: 20 }));
    const run = await cli(app, ["upload-video", "--video-path", video, "--title", "Hi", "--no-made-for-kids"], { env: { YOUTUBE_MCP_HOME: scratch, YOUTUBE_ACCOUNTS: accounts } });
    expect(run.code).toBe(EXIT.usage);
    expect(run.stderr).toContain("Main, Clips");
  });

  it("says when the file is not there", async () => {
    useEnv(ONE);
    const run = await cli(app, ["upload-video", "--video-path", join(scratch, "missing.mp4"), "--title", "Hi", "--no-made-for-kids"], { env: ONE });
    expect(run.code).toBe(EXIT.notFound);
  });

  it("runs as a job over MCP, with a status tool to follow it", async () => {
    const mcp = await connect(app, { env: ONE });
    const tools = await mcp.listTools();
    await mcp.close();
    const upload = tools.find((tool) => tool.name === "upload_video")!;
    expect(Object.keys((upload.inputSchema as { properties: object }).properties)).toEqual(expect.arrayContaining(["wait_seconds", "confirm", "made_for_kids", "publish_at"]));
    expect(tools.map((tool) => tool.name)).toContain("upload_video_status");
  });
});

describe("where a video stands", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  it.each([
    [{ status: { uploadStatus: "uploaded", privacyStatus: "private" } }, "uploaded"],
    [{ status: { uploadStatus: "uploaded" }, processingDetails: { processingStatus: "processing" } }, "processing"],
    [{ status: { uploadStatus: "processed", privacyStatus: "private", publishAt: "2026-11-01T15:00:00Z" } }, "scheduled"],
    [{ status: { uploadStatus: "processed", privacyStatus: "public" } }, "public"],
    [{ status: { uploadStatus: "rejected", rejectionReason: "duplicate" } }, "rejected"],
    [{ status: { uploadStatus: "failed", failureReason: "codec" } }, "failed"],
  ])("%j is %s", (item, state) => {
    expect(videoState(item, now)).toBe(state);
  });
});
