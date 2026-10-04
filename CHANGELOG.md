# Changelog

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
