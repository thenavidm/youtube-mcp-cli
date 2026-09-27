# Working on youtube-mcp-cli

A YouTube MCP server and CLI: transcripts, research, comments, analytics and
channel management, as MCP tools and as shell commands.

## Shape

TypeScript, Node 20+, ESM. Published as `@thenavidm/youtube-mcp-cli`, with two
binaries on one file: `youtube-mcp` (the server) and `youtube-cli` (the
commands). stdio and streamable HTTP. Tests run against fakes, never the network.

```
src/
  index.ts            entry for both binaries: login, logout, doctor, then CLI or server
  server.ts           assembles the server and its instructions
  cli.ts              the shell surface, derived from ALL_TOOLS
  config.ts           env plus the saved channels into settings and accounts
  safety.ts           WriteGuard: confirm gating, read-only, audit log, annotations
  auth.ts             login (OAuth, saved per channel) and logout
  doctor.ts           reports each credential layer separately
  accounts/store.ts   the encrypted channel file in ~/.youtube-mcp-cli
  youtube/            API client, transcripts, the yt-dlp transport
  tools/              kit.ts is the seam, index.ts is ALL_TOOLS, one module per group
  transport/http.ts
scripts/check-counts.mjs  fails when a document's tool count disagrees with the server
```

## The things worth knowing before changing anything

**One array, two surfaces.** `tools/index.ts` exports `ALL_TOOLS`. `register()`
in `tools/kit.ts` turns each spec into an MCP tool and `cli.ts` turns the same
spec into a command, through the same handler and the same `WriteGuard`. Add a
tool to the array and it is a command too. Never describe a tool a second time.

**`cli.ts` is copied, not written.** It comes from the shared MCP plus CLI asset.
Change it only where YouTube genuinely differs, and keep the exit codes as they
are: 0 ok, 2 usage or a refused write, 3 not found, 4 auth, 5 API, 7 rate
limited, 10 nothing configured.

**Read-only removes tools rather than refusing them.** `registerAll` skips every
non-read spec when `YOUTUBE_READ_ONLY=1`, and the CLI hides the same ones. A
model cannot misuse a tool it cannot see.

**Confirmation goes on irreversible tools only.** Currently `reply_to_comment`
and `delete_video`. Not on `update_video`. The test is whether the user could
undo it from youtube.com in one action. The guard knows its surface, so a
refusal says `--confirm` in a terminal and `confirm: true` through MCP.

**Channels come from env and from the store.** `config.ts` reads
`YOUTUBE_ACCOUNTS` or `YOUTUBE_REFRESH_TOKEN`, then every channel saved by
`youtube-cli login`, with env winning on a clashing id. Each saved channel keeps
its own OAuth client, because a refresh token only works with the client that
issued it. Tests point `YOUTUBE_MCP_HOME` at a scratch directory so a real login
on the machine never leaks in.

**Transcripts do not use the Captions API.** That one needs OAuth and channel
ownership, so it only ever reads your own videos. The track list is scraped from
the watch page, and the track body comes through `yt-dlp`, because YouTube began
answering the track URL with 200 and an empty body during 2026 unless the request
carries a proof-of-origin token. If transcripts break, check whether the watch
page shape moved before assuming yt-dlp is at fault.

**Both OAuth client spellings are read.** `YOUTUBE_CLIENT_ID` and
`YOUTUBE_OAUTH_CLIENT_ID`, same for the secret. Accepting one and ignoring the
other produces `unauthorized_client`, which is indistinguishable from a revoked
grant. There is a test for this.

**Multi-account refuses rather than defaults.** With two or more channels
connected and no `account` passed, `resolveAccount` throws and names the
choices. Do not add a fallback to the first one.

**Missing setup is not a 401.** A call with nothing configured throws a plain
error containing "is configured", which the CLI maps to exit 10. A real 401 from
Google maps to 4. Keep them apart: they need opposite fixes.

## Before you say it works

```bash
npm run typecheck && npm run build && npm test && npm run check:counts
npx @modelcontextprotocol/inspector node dist/index.js
```

Then the binary itself: `youtube-cli` bare, one `--help`, one real read such as
`youtube-cli list-transcript-languages dQw4w9WgXcQ`, a missing argument (exits
2) and nothing configured (exits 10). A green suite says nothing about whether
the server starts and lists its tools.

Setup steps in `INSTALL.md` come from Google's live documentation, not memory.
The console was reorganized into **Google Auth platform** and most tutorials
online still describe the old Credentials flow. If you touch those steps,
re-read the source first.
