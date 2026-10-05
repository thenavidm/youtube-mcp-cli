/**
 * The YouTube app: everything Slipway needs to ship the MCP server and the CLI.
 *
 * This file only describes. It never starts anything, so `slipway check` and
 * tests can import it; `index.ts` is what runs.
 */

import { createRequire } from "node:module";
import { slipway, type CliIO } from "@thenavidm/slipway";
import { loadConfig } from "./config.js";
import { doctor } from "./doctor.js";
import { INSTRUCTIONS } from "./guide.js";
import { ALL_TOOLS } from "./tools/index.js";
import { makeContext, type ToolContext } from "./tools/kit.js";

const require = createRequire(import.meta.url);
export const VERSION: string = (require("../package.json") as { version: string }).version;

const signIn = async (_io: CliIO, args: readonly string[]): Promise<number> => {
  const { login } = await import("./auth.js");
  return login([...args]);
};

export const app = slipway<ToolContext>({
  name: "youtube",
  title: "YouTube",
  version: VERSION,
  package: "@thenavidm/youtube-mcp-cli",
  description: "YouTube transcripts for any public video, channel research, and your own channels' videos, comments and analytics",
  instructions: INSTRUCTIONS,
  // Transcripts need no credentials, so nothing here is required before the first call.
  context: () => makeContext(loadConfig()),
  secrets: ({ config }) => [config.apiKey, ...config.accounts.flatMap((account) => [account.refreshToken, account.accessToken])],
  tools: ALL_TOOLS,
  doctor,
  // yt-dlp, the API key and every channel's token each fail differently, and only a request tells, so doctor makes one per source every time, as 2.0 did.
  doctorNetwork: true,
  login: {
    usage: "login [--api-key KEY]",
    help: "connect a channel, once per channel; --api-key saves a research key",
    run: signIn,
  },
  commands: [
    { name: "auth", usage: "auth [--api-key KEY]", help: "the same as login, by the name 1.x used", hidden: true, run: signIn },
    {
      name: "logout",
      usage: "logout <channel> | logout --api-key",
      help: "forget a saved channel, or the saved API key",
      run: async (_io, args) => {
        const { logout } = await import("./auth.js");
        return logout([...args]);
      },
    },
  ],
  settings: [
    { env: "YOUTUBE_API_KEY", description: "Public search and channel lookup, or `login --api-key`.", secret: true },
    { env: "YOUTUBE_ACCOUNTS", description: "Several channels at once, as a JSON array.", secret: true },
    { env: "YOUTUBE_REFRESH_TOKEN", description: "One channel.", secret: true },
    { env: "YOUTUBE_ACCESS_TOKEN", description: "One channel, short-lived, for testing.", secret: true, tuning: true },
    { env: "YOUTUBE_CHANNEL_NAME", description: "What to call that one channel. Defaults to default.", tuning: true },
    { env: "YOUTUBE_CLIENT_ID", description: "Your OAuth client, which `login` needs." },
    { env: "YOUTUBE_CLIENT_SECRET", description: "Its secret.", secret: true },
    { env: "YOUTUBE_MCP_HOME", description: "Where `login` saves channels. Defaults to ~/.youtube-mcp-cli.", tuning: true },
    { env: "YOUTUBE_TRANSCRIPT_LANG", description: "Default transcript language. Defaults to en.", tuning: true },
    { env: "YOUTUBE_YTDLP_PATH", description: "Path to yt-dlp, if it is not on PATH.", tuning: true },
    { env: "YOUTUBE_YTDLP_COOKIES", description: "A cookies.txt from a browser signed in to YouTube, for the bot check.", secret: true },
    { env: "YOUTUBE_OAUTH_CLIENT_ID", description: "Another name for YOUTUBE_CLIENT_ID.", tuning: true },
    { env: "YOUTUBE_OAUTH_CLIENT_SECRET", description: "Another name for YOUTUBE_CLIENT_SECRET.", secret: true, tuning: true },
    { env: "YOUTUBE_OAUTH_PORT", description: "The localhost port `login` listens on. Defaults to 8765.", tuning: true },
    { env: "YOUTUBE_REQUEST_TIMEOUT_MS", description: "Per-request deadline. Defaults to 30000.", tuning: true },
  ],
  links: { repository: "https://github.com/thenavidm/youtube-mcp-cli" },
});
