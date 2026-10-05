/**
 * `youtube-cli doctor`: check each of the three things this server can reach,
 * the way it would reach them.
 *
 * Transcripts need yt-dlp and nothing else, research needs an API key, and a
 * connected channel needs a refresh token that still works. Each fails for a
 * different reason with a different fix, so each is checked on its own, with a
 * real request, as 2.0 did. Slipway runs this on every `doctor`, after its own
 * checks.
 */

import type { DoctorCheck } from "@thenavidm/slipway";
import { storePath } from "./accounts/store.js";
import type { ToolContext } from "./tools/kit.js";
import { YouTubeClient } from "./youtube/api.js";
import { fetchTranscript } from "./youtube/transcripts.js";
import { isAvailable } from "./youtube/ytdlp.js";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function doctor({ config }: ToolContext, options: { network: boolean }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  if (await isAvailable()) {
    checks.push({ name: "yt-dlp", ok: true, detail: "found; transcripts need nothing else" });
    if (options.network) {
      try {
        const transcript = await fetchTranscript("dQw4w9WgXcQ");
        checks.push({ name: "Transcripts", ok: true, detail: `fetched a real one, ${transcript.segments.length} segments` });
      } catch (error) {
        checks.push({ name: "Transcripts", ok: false, detail: message(error) });
      }
    }
  } else {
    checks.push({ name: "yt-dlp", ok: false, detail: "not found", fix: "Install it with `brew install yt-dlp` or `pipx install yt-dlp`, or set YOUTUBE_YTDLP_PATH." });
  }

  if (!config.apiKey) {
    checks.push({
      name: "API key",
      ok: false,
      warn: true,
      detail: "none, so search and channel lookup are unavailable",
      fix: "Run `youtube-cli login --api-key KEY`, or set YOUTUBE_API_KEY.",
    });
  } else if (options.network) {
    try {
      await new YouTubeClient({ apiKey: config.apiKey }).get("/videos", { part: "id", id: "dQw4w9WgXcQ" });
      checks.push({ name: "API key", ok: true, detail: "works" });
    } catch (error) {
      checks.push({ name: "API key", ok: false, detail: `rejected: ${message(error)}` });
    }
  } else {
    checks.push({ name: "API key", ok: true, detail: "set; --network checks it" });
  }

  if (config.accounts.length === 0) {
    checks.push({
      name: "Channels",
      ok: false,
      warn: true,
      detail: `none connected, so account tools and Analytics are unavailable (saved logins live in ${storePath()})`,
      fix: "Run `youtube-cli login`, once per channel.",
    });
    return checks;
  }
  for (const account of config.accounts) {
    if (!options.network) {
      checks.push({ name: account.name, ok: true, detail: "connected; --network checks the token" });
      continue;
    }
    try {
      const res = await new YouTubeClient({ account }).get<{ items?: { snippet?: { title?: string } }[] }>(
        "/channels",
        { part: "snippet", mine: true },
        true,
      );
      checks.push({ name: account.name, ok: true, detail: `connected to ${res.items?.[0]?.snippet?.title ?? "(no channel)"}` });
    } catch (error) {
      checks.push({ name: account.name, ok: false, detail: message(error), fix: "Run `youtube-cli login` again for this channel." });
    }
  }
  return checks;
}
