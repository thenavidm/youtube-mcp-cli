#!/usr/bin/env node
/**
 * Entry point, for both binaries.
 *
 * `youtube-mcp`             stdio, which is what an MCP client launches
 * `youtube-mcp --http`      HTTP, for a machine that is always on
 * `youtube-cli <command>`   run one tool from the shell, see cli.ts
 * `youtube-cli login`       connect a channel, once per channel
 * `youtube-cli doctor`      check the setup and say what is wrong
 *
 * The shell surface is generated from the same `ALL_TOOLS` array the server
 * registers, so every tool is a command and neither surface can drift.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";
import { httpOptionsFromEnv, startHttpServer } from "./transport/http.js";
import { isCliCommand, runCli } from "./cli.js";

const HELP = `youtube-mcp-cli ${VERSION}

  youtube-cli                         Every command, one line each.
  youtube-cli <command> [--flags]     Run one tool. Same names as the MCP surface.
  youtube-cli <command> --help        What that command takes.
  youtube-cli schema <command>        The JSON schema an MCP client sees.
  youtube-cli login                   Connect a channel. Run once per channel.
  youtube-cli login --api-key KEY     Save an API key for search and research.
  youtube-cli logout <channel>        Forget a saved channel.
  youtube-cli doctor                  Check the setup and report what is wrong.

  youtube-mcp                         Run over stdio. This is what an MCP client launches.
  youtube-mcp --http [--port=N]       Run over HTTP, for a machine that is always on.
  youtube-mcp --version               Print the version.

  Every command prints JSON on --json, and errors as JSON on stderr.

Credentials. Transcripts need none. Channels resolve in this order:

  YOUTUBE_ACCOUNTS          JSON array, several channels at once
  YOUTUBE_REFRESH_TOKEN     one channel
  YOUTUBE_ACCESS_TOKEN      one channel, short-lived, for testing
  YOUTUBE_CHANNEL_NAME      what to call that one channel, default "default"
  ~/.youtube-mcp-cli/       every channel saved by \`youtube-cli login\`

  YOUTUBE_API_KEY           public search and channel lookup, or \`login --api-key\`
  YOUTUBE_CLIENT_ID         your OAuth client, which login needs
  YOUTUBE_CLIENT_SECRET     (YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET work too)

Options:

  YOUTUBE_READ_ONLY=1               hide every write
  YOUTUBE_ALLOW_DESTRUCTIVE=0       keep writes, block the irreversible ones
  YOUTUBE_AUDIT_LOG                 append-only log of every attempted write
  YOUTUBE_REQUEST_TIMEOUT_MS        per-request deadline, default 30000
  YOUTUBE_TRANSCRIPT_LANG           default transcript language, default en
  YOUTUBE_YTDLP_PATH                path to yt-dlp if it is not on PATH
  YOUTUBE_MCP_HOME                  where login saves channels, default ~/.youtube-mcp-cli
  YOUTUBE_OAUTH_PORT                login's localhost port, default 8765
  YOUTUBE_HTTP_PORT / _HOST / _TOKEN  for --http

https://github.com/thenavidm/youtube-mcp-cli
`;

/**
 * Which name launched us.
 *
 * One file serves both binaries. `youtube-mcp` with no arguments is an MCP
 * client starting a stdio server and must stay silent on stdout. `youtube-cli`
 * with no arguments is a person asking what they can type, so it lists the
 * commands instead of hanging on a transport that will never speak.
 */
function invokedAsCli(): boolean {
  const name = (process.argv[1] ?? "").split("/").pop() ?? "";
  return name.startsWith("youtube-cli");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (invokedAsCli() && argv.length === 0) {
    process.exitCode = await runCli(["tools"]);
    return;
  }

  // Checked before --help and --version so `<command> --help` reaches the tool.
  if (isCliCommand(argv)) {
    process.exitCode = await runCli(argv);
    return;
  }

  // These belong to the entry point rather than the tool list, and they are
  // what someone types when nothing works yet. `auth` is the 1.x name for login.
  const ENTRY_COMMANDS = new Set(["login", "auth", "logout", "doctor", "help"]);

  // An unknown word used to fall through and start the server, which then sat
  // waiting on stdin: a typo looked like a hang, and scripts saw exit code 0.
  if (
    invokedAsCli() &&
    command !== undefined &&
    !command.startsWith("-") &&
    !ENTRY_COMMANDS.has(command)
  ) {
    process.stderr.write(
      `${JSON.stringify({ error: `Unknown command '${command}'. Run \`youtube-cli\` to list them.` }, null, 2)}\n`,
    );
    process.exitCode = 2;
    return;
  }

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (command === "login" || command === "auth") {
    const { login } = await import("./auth.js");
    process.exitCode = await login(argv.slice(1));
    return;
  }
  if (command === "logout") {
    const { logout } = await import("./auth.js");
    process.exitCode = logout(argv.slice(1));
    return;
  }
  if (command === "doctor") {
    const { doctor } = await import("./doctor.js");
    process.exitCode = await doctor();
    return;
  }

  const built = buildServer();

  if (argv.includes("--http")) {
    await startHttpServer(built, httpOptionsFromEnv(process.argv));
    return;
  }
  await built.server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  // stderr, never stdout: stdout is the MCP protocol channel and anything
  // written there that is not a JSON-RPC frame breaks the client's parser.
  process.stderr.write(`[youtube-mcp] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
