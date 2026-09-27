/**
 * `youtube-cli doctor`: say what is set up and what is not, in the order that
 * matters. Most setup problems here are a missing API in the Cloud project or
 * an OAuth client that does not match the token, and neither is obvious from
 * the error the API returns at call time.
 */

import { loadConfig } from "./config.js";
import { isAvailable } from "./youtube/ytdlp.js";
import { fetchTranscript } from "./youtube/transcripts.js";
import { YouTubeClient } from "./youtube/api.js";
import { storePath } from "./accounts/store.js";

const ok = (s: string) => `  ok    ${s}`;
const bad = (s: string) => `  FAIL  ${s}`;
const info = (s: string) => `  --    ${s}`;

export async function doctor(): Promise<number> {
  const config = loadConfig();
  const lines: string[] = [];
  let failures = 0;

  lines.push("Transcripts (no credentials needed)");
  const ytdlp = await isAvailable();
  if (ytdlp) {
    lines.push(ok("yt-dlp found"));
    try {
      const t = await fetchTranscript("dQw4w9WgXcQ");
      lines.push(ok(`fetched a real transcript (${t.segments.length} segments)`));
    } catch (err) {
      failures++;
      lines.push(bad(`transcript fetch failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  } else {
    failures++;
    lines.push(
      bad("yt-dlp not found. Install it with `brew install yt-dlp` or `pipx install yt-dlp`."),
    );
  }

  lines.push("");
  lines.push("Public research");
  if (!config.apiKey) {
    lines.push(
      info("No API key: search and channel lookup are unavailable. Run `youtube-cli login --api-key KEY`."),
    );
  } else {
    try {
      const client = new YouTubeClient({ apiKey: config.apiKey });
      await client.get("/videos", { part: "id", id: "dQw4w9WgXcQ" });
      lines.push(ok("API key works"));
    } catch (err) {
      failures++;
      lines.push(bad(`API key rejected: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  lines.push("");
  lines.push(`Connected channels (saved logins live in ${storePath()})`);
  if (config.accounts.length === 0) {
    lines.push(info("None connected: account tools and Analytics are unavailable. Run `youtube-cli login`."));
  } else {
    for (const account of config.accounts) {
      try {
        const client = new YouTubeClient({ account });
        const res = await client.get<{ items?: { snippet?: { title?: string } }[] }>(
          "/channels",
          { part: "snippet", mine: true },
          true,
        );
        const title = res.items?.[0]?.snippet?.title ?? "(no channel)";
        lines.push(ok(`${account.name} -> ${title}`));
      } catch (err) {
        failures++;
        lines.push(bad(`${account.name}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  }

  if (config.readOnly) {
    lines.push("");
    lines.push(info("YOUTUBE_READ_ONLY=1: every write is disabled."));
  }

  console.log(lines.join("\n"));
  return failures === 0 ? 0 : 1;
}
