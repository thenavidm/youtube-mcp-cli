# Changelog

| Component | Version |
|---|---|
| Slipway | ^0.1.10 |
| MCP TypeScript SDK, through Slipway | 2.3.0 |
| YouTube Data API | v3 |
| YouTube Analytics API | v2 |
| yt-dlp, for transcripts | any current release |
| Node | >= 22 |

## 3.0.0, 2026-10-05

Built on [Slipway](https://github.com/thenavidm/slipway) 0.1.10. The 16 tools keep their names and arguments, and every difference below was measured against 2.0.0, the last version on npm, before release.

- **A person approves each irreversible call over MCP.** `delete_video` and `reply_to_comment` cannot be undone; Claude Code (2.1.246 and later) shows its own prompt for each, and a client that can show forms asks with an approval form whose one box starts unticked. Approvals are signed, bound to the exact call and work once. Where a client can do neither, the model's `confirm: true` still counts, and `YOUTUBE_CONFIRM=model` makes it enough everywhere. The audit log records who approved each write.
- **A smaller tool list.** 4,458 tokens in Claude Code with every tool loaded, down from 4,984: the per-tool `$schema` line, an `execution` field and `additionalProperties: false` are gone. The last one advertised strict input while unknown keys were dropped anyway; the schema now says what happens.
- **Exit codes come from the error, not its wording.** 2.0 searched each message, so a malformed `YOUTUBE_ACCOUNTS` exited 4 because its example names a refresh token. Google's reason still decides first: `quotaExceeded`, `rateLimitExceeded` and the other limit reasons exit 7 even when Google sends them as a 403, and YouTube refusing transcripts from this IP exits 7, as in 2.0. A transcript of a video that does not exist, or has no captions in the language asked, exits 3 instead of 5. yt-dlp not installed and a malformed `YOUTUBE_ACCOUNTS` exit 10. Naming a channel that is not connected, or none when several are, exits 2 instead of 5, and so does a write hidden by `YOUTUBE_READ_ONLY=1`, which exited 1. 1 now means an unexpected error. Google's reason comes along in `details`.
- **`which <words>` finds a command**, and `agent-context` describes every command, flag and setting as JSON. In Codex 0.159.3, finding the command that scores a channel against its own median took 83,295 input tokens over the CLI instead of 83,565 (median of five), because Codex asked `which` instead of reading the full command list.
- **`install <client>`** adds the server to Claude Code, Codex, Claude Desktop, Cursor, VS Code or Gemini CLI in each one's own format.
- **`YOUTUBE_YTDLP_COOKIES` works.** The bot-check error named it in 2.0, but nothing read it; transcripts now hand it to yt-dlp. The rate-limit error no longer names `YOUTUBE_TRANSCRIPT_PROXY`, which never existed.
- **Less work to start.** The entry turns on Node's compile cache, and the server spends 144 ms of CPU before its first answer where 2.0.0 spent 183 (median of 21 runs, taking turns on one busy Mac). npx installs 4 dependencies instead of 94.
- **The release carries the desktop extension.** The publish workflow attaches this version's `.mcpb` to the GitHub release, which the README sends Claude Desktop users to, and the CI handshake speaks JSON-RPC itself, since the old MCP SDK is no longer a dependency. 3.0.0 also carries 2.0.1's npx fix, which was tagged and never reached npm.
- **Docs fixes.** The README has a Features table, the icon loads from cdn.navid.me, the exit-code table lists 1, and THIRD_PARTY_NOTICES.md lists the production dependencies' licenses.

### Upgrading

Node 22 or newer; 2.0 ran on 20. Scripts keep working for success, a refused write, missing setup and rate limits; one that read exit 1 as a hidden write, or exit 5 as a missing video or captions, should read 2 and 3. Over MCP, expect an approval prompt or form before a video is deleted or a reply posted; a headless agent that should do either with `confirm: true` alone needs `YOUTUBE_CONFIRM=model`. A script that pipes JSON-RPC into the server must keep stdin open until it reads the answer: the server now stops when its input ends, as the MCP stdio binding asks. `--http` refuses a page from another site unless `YOUTUBE_HTTP_ALLOWED_ORIGINS` lists it. Over MCP in Codex the tool list prints 7 tokens longer, for the description of `confirm` on the two irreversible tools. Some terminal screens grew: the command list by 23 tokens, for the lines that point to `which` and `--help`; `delete-video --help` by 14; and the refusal to delete without `--confirm` by 18, for its code and a hint that `--confirm` is only for an action the user asked for.

## 2.0.1, 2026-10-04

- **`npx -y @thenavidm/youtube-mcp-cli` starts the MCP server whatever order npm keeps.** npx starts whichever binary the npm registry lists first when they share one file, and the registry does not keep the published order. For this package that happened to be the server; for 23 others it was the CLI. A third binary named after the package, on its own file, now always starts the server, and npx picks it by name.

## 2.0.0

The same 16 tools, now as shell commands too, and several channels without a
config file.

**Renamed to `@thenavidm/youtube-mcp-cli`.** One install gives two binaries on
one file: `youtube-mcp` is the server an MCP client launches, `youtube-cli` is
the one you type. The old package name stays on npm at 1.0.0.

**A command line for every tool.** `youtube-cli` lists them, `<command> --help`
shows the flags, and `schema <command>` prints the exact JSON Schema an MCP
client receives. Both surfaces read one array of tool definitions, so they
cannot drift. `--agent` sets JSON, compact output and no prompts in one flag,
`--select` trims a JSON result to the fields you name, and errors are always JSON
on stderr. Exit codes let a script branch without reading prose: 2 usage, 3 not
found, 4 auth, 5 API, 7 rate limited, 10 nothing configured.

**Login once per channel.** `youtube-cli login` runs the OAuth flow and saves the
channel to `~/.youtube-mcp-cli/channels.json`, encrypted with a key derived from
this machine and account, written 0600. Run it again for each channel. The CLI
and the MCP server both read the file, so several channels work with no
`YOUTUBE_ACCOUNTS` array to paste. `--account` picks one, and with two or more
connected the account tools still refuse to guess. `logout <channel>` forgets
one. `login --api-key KEY` saves the API key the same way. `login --print` also
prints the env entry for a machine where the file cannot live. `auth` still
works as the old name for `login`.

In 1.0.0, `auth` printed a refresh token and stored nothing, which left the
multi-channel setup as a JSON array assembled by hand.

**Errors that say what to do next.** A call that needs setup that is not there
now says "No account is configured" or "No API key is configured", names the
`youtube-cli login` command that fixes it, and exits 10. It used to report a 401,
which reads like an expired credential.

**Refusals name the right flag.** A guarded write refused in the terminal asks
for `--confirm`; the same refusal through MCP asks for `confirm: true`.

**The context cost is measured in Claude Code**: about 5,000 tokens a message
with every tool loaded, about 490 with Claude Code's default tool search, and
2,300 for `SKILL.md` once. The README has the method.

**A used-up quota exits 7.** Google sends it as a 403, which the CLI read as a
rejected credential and exited 4.

**Also:** a Claude Desktop extension, a CI handshake that compares the tool count
against the source instead of a typed number, a script that fails when any
document's tool count disagrees with the server, and American spelling
throughout.

## 1.0.0

First release. 16 tools.

**Transcripts, with no setup at all.** Reads any public video, not only your own.
No API key, no OAuth, no quota. Prose or timestamped output, phrase search that
returns links jumping to the second, and batch fetching for up to 20 videos.

YouTube stopped serving caption text from the track URL directly during 2026: it
answers with 200 and an empty body unless the request carries a proof-of-origin
token tied to a real player session. The track list still comes from the watch
page, and the track body now comes through `yt-dlp`, which mints one.

**Research that carries statistics.** YouTube's search endpoint returns no view
counts, subscriber counts or durations, so results cannot be judged. Every search
here joins the statistics back on before returning.

`analyze_channel` scores recent videos against the channel's own median rather
than an absolute view count, which is the only comparison that transfers between
a small channel and a large one. Shorts are flagged separately.

**Multi-channel from the start.** With more than one channel connected, every
account tool requires `account` and refuses to guess, because acting on the wrong
channel is not recoverable.

**Writes on, with two guarded.** `reply_to_comment` and `delete_video` need
`confirm: true`. `update_video` does not, because it is reversible.
`YOUTUBE_READ_ONLY=1` removes every write from the tool list rather than failing
at call time.
