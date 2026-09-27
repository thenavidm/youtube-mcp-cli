/**
 * `youtube-cli login` connects a channel. `youtube-cli logout` forgets one.
 *
 * Google will not hand a refresh token to a command line, so login opens a
 * browser, catches the redirect on localhost, exchanges the code, and saves the
 * channel to the encrypted store in ~/.youtube-mcp-cli. Run it once per channel.
 * Every command and the MCP server read the store, so several channels work
 * with no config at all, and `--account <name>` picks one.
 *
 * `--print` also prints the refresh token as an env entry, for a machine where
 * the store cannot live, such as a container.
 */

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { loadStore, removeChannel, setApiKey, storePath, upsertChannel } from "./accounts/store.js";

const PORT = Number(process.env.YOUTUBE_OAUTH_PORT ?? 8765);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * The account tools need read AND write on the channel, plus Analytics.
 * `force-ssl` is the one people miss: captions and comment moderation both
 * refuse to work without it, with an error that blames the wrong thing.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Printing the URL is the real fallback.
  }
}

/** `--name value` or `--name=value`. */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  const token = argv[i] as string;
  return token.includes("=") ? token.slice(token.indexOf("=") + 1) : (argv[i + 1] ?? "");
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:15px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:80px auto;padding:0 24px">` +
  `<h1 style="font-size:20px">${title}</h1>${body}</body>`;

const slug = (s: string) => s.toLowerCase().replace(/^@/, "").trim().replace(/\s+/g, "-");

export async function login(argv: string[]): Promise<number> {
  const apiKey = flag(argv, "api-key");
  if (apiKey !== undefined) {
    if (!apiKey.trim()) {
      console.error("--api-key needs a value: youtube-cli login --api-key AIza...");
      return 2;
    }
    const path = setApiKey(apiKey.trim());
    console.log(`API key saved to ${path}, encrypted and 0600. Search and channel research are on.`);
    return 0;
  }

  const clientId = (
    flag(argv, "client-id") ??
    process.env.YOUTUBE_CLIENT_ID ??
    process.env.YOUTUBE_OAUTH_CLIENT_ID ??
    ""
  ).trim();
  const clientSecret = (
    flag(argv, "client-secret") ??
    process.env.YOUTUBE_CLIENT_SECRET ??
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET ??
    ""
  ).trim();

  if (!clientId || !clientSecret) {
    console.error(
      "Login needs your OAuth client. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET,\n" +
        "or pass --client-id and --client-secret.\n\n" +
        "They come from your own Google Cloud project, see INSTALL.md. Nobody else's\n" +
        "client will work, because a refresh token only works with the client that issued it.",
    );
    return 10;
  }

  const printEnv = argv.includes("--print");
  const state = randomBytes(16).toString("hex");
  const url =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES.join(" "),
      // Without offline + consent Google returns an access token only, and the
      // connection dies an hour later. select_account lets you pick a different
      // Google account for each channel.
      access_type: "offline",
      prompt: "consent select_account",
      state,
    }).toString();

  console.error(`Opening your browser. If nothing happens, open this:\n\n${url}\n`);
  console.error("Pick the channel to connect. Run `youtube-cli login` again for each other channel.\n");

  return new Promise<number>((resolve) => {
    const server = createServer(async (req, res) => {
      const incoming = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (incoming.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const finish = (code: number, status: number, title: string, body: string) => {
        res.writeHead(status, { "Content-Type": "text/html" });
        res.end(page(title, body));
        server.close();
        resolve(code);
      };

      const error = incoming.searchParams.get("error");
      const code = incoming.searchParams.get("code");
      if (error || !code) {
        finish(4, 400, "Authorization cancelled", `<p>Google said: <code>${error ?? "no code"}</code></p>`);
        return;
      }
      if (incoming.searchParams.get("state") !== state) {
        finish(4, 400, "State mismatch", "<p>Start over with <code>youtube-cli login</code>.</p>");
        return;
      }

      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }).toString(),
      });
      const token = (await tokenRes.json()) as {
        refresh_token?: string;
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !token.refresh_token) {
        const why =
          token.error === undefined && token.access_token
            ? "Google returned an access token but no refresh token. That happens when this client was already authorized for this channel. Revoke it at https://myaccount.google.com/permissions and run login again."
            : `${token.error ?? tokenRes.status}: ${token.error_description ?? ""}`;
        console.error(`\n${why}`);
        finish(4, 500, "Could not get a refresh token", `<p>${why}</p>`);
        return;
      }

      // Name the entry after the channel so --account reads naturally later.
      let name = "channel";
      let handle: string | undefined;
      let channelId: string | undefined;
      try {
        const me = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          { headers: { Authorization: `Bearer ${token.access_token}` } },
        );
        const body = (await me.json()) as {
          items?: { id?: string; snippet?: { title?: string; customUrl?: string } }[];
        };
        const first = body.items?.[0];
        name = first?.snippet?.title ?? name;
        handle = first?.snippet?.customUrl;
        channelId = first?.id;
      } catch {
        // Naming is a convenience, not a requirement.
      }

      const id = slug(handle ?? name);
      const path = upsertChannel({
        id,
        name,
        handle,
        channel_id: channelId,
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refresh_token,
        connected_at: new Date().toISOString(),
      });
      const total = loadStore().channels.length;

      console.log(`\nConnected: ${name}${handle ? ` (${handle})` : ""}`);
      console.log(`Saved to ${path}, encrypted and 0600. ${total} channel${total === 1 ? "" : "s"} connected.\n`);
      console.log(`  Use it:           youtube-cli list-my-videos --account ${id}`);
      console.log(`  Connect another:  youtube-cli login`);
      console.log(`  See them all:     youtube-cli list-accounts\n`);
      if (printEnv) {
        console.log("For a machine without the store, the env entry is:\n");
        console.log(`  YOUTUBE_ACCOUNTS='${JSON.stringify([{ name, refresh_token: token.refresh_token }])}'\n`);
      }

      finish(0, 200, `${name} connected`, "<p>Saved. You can close this tab and go back to the terminal.</p>");
    });

    server.listen(PORT, () => openBrowser(url));
    server.on("error", (err: NodeJS.ErrnoException) => {
      console.error(
        err.code === "EADDRINUSE"
          ? `Port ${PORT} is busy. Free it, or set YOUTUBE_OAUTH_PORT to another port and add that redirect URI to your OAuth client.`
          : String(err),
      );
      resolve(1);
    });
  });
}

export function logout(argv: string[]): number {
  if (argv.includes("--api-key")) {
    setApiKey(undefined);
    console.log("API key removed.");
    return 0;
  }

  const hint = argv.find((a) => !a.startsWith("-"));
  const saved = loadStore().channels;
  if (!hint) {
    console.error(
      `Name the channel: youtube-cli logout <name>. Saved: ${saved.map((c) => c.id).join(", ") || "(none)"}`,
    );
    return 2;
  }

  const removed = removeChannel(hint);
  if (!removed) {
    console.error(
      `No saved channel matches "${hint}". Saved: ${saved.map((c) => c.id).join(", ") || "(none)"}. Channels set through YOUTUBE_ACCOUNTS or YOUTUBE_REFRESH_TOKEN are removed from your client config instead.`,
    );
    return 3;
  }

  console.log(
    `Removed ${removed.name} from ${storePath()}. Its refresh token keeps working until you revoke it at https://myaccount.google.com/permissions.`,
  );
  return 0;
}
