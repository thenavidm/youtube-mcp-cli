<img src="https://cdn.navid.me/connectors/youtube-icon.png" alt="YouTube" width="88">

# YouTube MCP Server & CLI

[![npm](https://img.shields.io/npm/v/@thenavidm%2Fyoutube-mcp-cli?color=orange&label=npm)](https://www.npmjs.com/package/@thenavidm/youtube-mcp-cli)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![YouTube](https://img.shields.io/badge/YouTube-@thenavidm-red?logo=youtube&logoColor=white)](https://youtube.com/@thenavidm?sub_confirmation=1)
[![X](https://img.shields.io/badge/X-@thenavidm-black?logo=x)](https://x.com/thenavidm)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-thenavidm-0A66C2?logo=linkedin&logoColor=white)](https://linkedin.com/in/thenavidm)

YouTube MCP server and CLI for Claude Code and AI agents. 16 tools for transcripts, search, channel research, comments, analytics and multi-channel management.

One install gives you both surfaces, the same tools under the same names.

Read the transcript of any public YouTube video, with nothing set up. Search
results come back with view counts attached, which YouTube's own search endpoint
does not return.

Connect as many channels as you run, with one login each and no config file.

Built and maintained by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=referral&utm_campaign=youtube-mcp-cli&utm_content=readme). Built on [Slipway](https://github.com/thenavidm/slipway), which turns one definition of each tool into the MCP server and the CLI.

```
You: what does this video actually say about pricing?
     https://youtu.be/dQw4w9WgXcQ

Claude: [search_transcript] Three mentions.

        [2:14] "we never charge for the first seat"
        [7:41] "the pricing page is deliberately one number"
        [11:02] "annual is not a discount, it is a commitment"

        Jump straight to 7:41 for the reasoning.
```

## Two ways to use it

### Command line

`youtube-cli` in your terminal, for scripting, cron, pipes, or a quick question
without opening anything:

```bash
youtube-cli                                                  # every command, one line each
youtube-cli get-transcript --video https://youtu.be/dQw4w9WgXcQ
youtube-cli list-transcript-languages dQw4w9WgXcQ
youtube-cli search-videos "local-first software"             # with view counts
youtube-cli list-comments --video-id dQw4w9WgXcQ --limit 20
youtube-cli login                                            # connect a channel, once each
youtube-cli list-my-videos --account thenavidm --limit 10
youtube-cli <command> --help                                 # what any command takes
```

`--confirm` is the shell spelling of the confirmation that replying to a comment
and deleting a video require. `--agent` gives compact JSON with no prompts, and
errors are JSON on stderr whichever output you pick.

`youtube-cli schema <command>` prints the exact JSON Schema an MCP client
receives for that tool, which is how you can check the two surfaces really are
one thing.

### MCP server, for your AI app

`youtube-mcp` is what Claude Code, Claude Desktop, Cursor and the rest launch.
You never run it by hand:

```bash
claude mcp add youtube -- npx -y @thenavidm/youtube-mcp-cli@latest
```

Then just ask: _"which of this channel's last 30 videos actually overperformed?"_

Replying to a comment and deleting a video wait for your approval in the client,
as [section 9](#9-writing-safely-) explains.

Channels you connected with `youtube-cli login` on this machine are read
automatically, so the command needs no credentials. Every other client is in
[section 4](#4-connect-your-client-).

### Which one

| Where you are | What you can reach |
|---|---|
| An agent that can run shell commands, like Claude Code or Cursor | Both. The CLI is the cheaper one: it costs almost nothing until you type it |
| claude.ai, the Claude Desktop chat tab, or a phone | The server only. There is no shell to run a command in |
| A terminal, a script, cron or CI | The CLI only. There is no MCP client in a shell |

They are the same program reading the same tool definitions, so anything one
can do, the other can.

## Features

Every tool is both a command and an MCP tool, with the same name. The command
is the tool name with dashes.

| Capability | CLI command | MCP tool |
|---|---|---|
| Transcripts of any public video, no credentials | `youtube-cli get-transcript` / `get-transcripts` / `search-transcript` / `list-transcript-languages` | `get_transcript` / `get_transcripts` / `search_transcript` / `list_transcript_languages` |
| Research any channel or video | `youtube-cli search-videos` / `get-channel` / `analyze-channel` / `get-video` | `search_videos` / `get_channel` / `analyze_channel` / `get_video` |
| Your channels and their numbers | `youtube-cli list-accounts` / `get-my-channel` / `get-channel-analytics` / `list-my-videos` | `list_accounts` / `get_my_channel` / `get_channel_analytics` / `list_my_videos` |
| Comments | `youtube-cli list-comments` / `reply-to-comment` | `list_comments` / `reply_to_comment` |
| Edit or delete your videos | `youtube-cli update-video` / `delete-video` | `update_video` / `delete_video` |
| Connect a channel or an API key | `youtube-cli login` / `logout` | not tools |
| Check your setup | `youtube-cli doctor` | not a tool |

All 16 are in [section 7](#7-tools-).

## Contents

| # | Section | What is in it |
|---|---|---|
| 1 | [What you can ask it](#1-what-you-can-ask-it-) | Real prompts, not features |
| 2 | [Quick install](#2-quick-install-) | One line, no account needed |
| 3 | [Set up your account](#3-set-up-your-account-) | API key, then your channels |
| 4 | [Connect your client](#4-connect-your-client-) | Claude, Cursor, Windsurf, the rest |
| 5 | [Check it worked](#5-check-it-worked-) | And the two things that fail |
| 6 | [Which surface, and what each costs](#6-which-surface-and-what-each-costs-) | Measured in Claude Code, and how to spend less |
| 7 | [Tools](#7-tools-) | All 16, grouped by what they need |
| 8 | [Output and exit codes](#8-output-and-exit-codes-) | What scripts branch on |
| 9 | [Writing safely](#9-writing-safely-) | What is guarded and what is not |
| 10 | [Several channels](#10-several-channels-) | Login once each, pick by name |
| 11 | [Notes and gotchas](#11-notes-and-gotchas-) | How YouTube really behaves |
| 12 | [Your data](#12-your-data-) | What is stored, and where |
| 13 | [Troubleshooting](#13-troubleshooting-) | Symptom to cause |
| 14 | [FAQ](#14-faq-) | Including what an MCP server is |

## 1. What you can ask it 💬

- Summarize this video in five bullets.
- Find where she talks about retention in this talk.
- Pull the transcripts of these six videos and tell me what the openings have in common.
- Which of this channel's last 30 videos actually overperformed?
- Compare how these two channels title their videos.
- Show me videos about local-first software from the last year with over 50,000 views.
- Read the comments on this video and group them by what people are asking for.
- What did my last video do on watch time versus the one before?
- Fix the typo in the title of that video.
- Which of my videos are still unlisted?

The one thing that is impossible without this: reading what was said in somebody
else's video. YouTube's Captions API only serves videos you own, so every
official route stops at your own channel. Transcripts here come from the public
caption tracks instead, so any public video is readable, and it needs no
credentials at all.

## 2. Quick install ⚡

Node 20 or newer, and `yt-dlp` for transcripts.

```bash
npx -y @thenavidm/youtube-mcp-cli@latest --version
```

That is the whole install for an MCP client. `npx` fetches it on demand, so
there is nothing to update later.

For the command line, install it globally:

```bash
npm install -g @thenavidm/youtube-mcp-cli
youtube-cli
```

That gives you two commands: `youtube-mcp` is the server your AI tools launch,
`youtube-cli` is the one you type. They are one program, and the name only
decides what happens when you pass no arguments.

Transcripts also need `yt-dlp`, because YouTube stopped serving caption text
directly:

```bash
brew install yt-dlp        # macOS
pipx install yt-dlp        # everywhere else
```

### Before you start

| You need | Check with | If missing |
|---|---|---|
| Node 20 or newer | `node -v` | [nodejs.org](https://nodejs.org) |
| yt-dlp, for transcripts | `yt-dlp --version` | `brew install yt-dlp` or `pipx install yt-dlp` |
| A Google Cloud project, for search and your channels | [console.cloud.google.com](https://console.cloud.google.com) | Free, no card, see section 3 |

## 3. Set up your account 🔑

Three levels. Pick the one that matches what you want, because most people never
need the third.

**Transcripts need nothing.** Skip this whole section. It already works.

**Search, research and comments need an API key.** About ten minutes.

**Your own channels need OAuth.** About half an hour, most of it forms.

[INSTALL.md](INSTALL.md) is the long version, with every click and every failure
worth knowing about in advance.

### An API key

1. In the [Google Cloud console](https://console.cloud.google.com), create a project.
2. In **APIs & Services > Library**, enable **YouTube Data API v3**. Add
   **YouTube Analytics API** too if you will want watch time later.
3. In **APIs & Services > Credentials**, choose **Create credentials > API key**,
   then click **Restrict key** and limit it to the YouTube APIs.
4. Save it:

```bash
youtube-cli login --api-key AIza...
```

It is stored encrypted on this machine, and every MCP client here picks it up.
On another machine, set `YOUTUBE_API_KEY` in the client config instead.

### Your own channels

1. Go to **Google Auth platform > Branding**, click **Get Started**, choose
   **External** as the audience, and finish.
2. Open **Audience**, and under **Test users** add the Google address that owns
   each channel. Skipping this is the single most common reason login fails.
3. Go to **Google Auth platform > Clients**, click **Create Client**, choose
   **Desktop app**, and copy the client ID and secret.
4. Connect each channel:

```bash
export YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
export YOUTUBE_CLIENT_SECRET=...
youtube-cli login
```

A browser opens, you pick the channel, and it is saved. **Run `youtube-cli
login` once per channel.** Then `youtube-cli list-accounts` shows them all.
[Section 10](#10-several-channels-) covers using several.

You do not need Google to verify the app, but do click **Publish app** under
**Audience**. An app left in testing issues refresh tokens that expire after
seven days, so login would stop working every week.

## 4. Connect your client 🔌

Every block below is complete on its own. Pick your client, paste, done.

If you ran `youtube-cli login` on the same machine, leave the `env` block out
entirely: the server reads your saved channels and API key itself. Otherwise put
in whichever of these you have: `YOUTUBE_API_KEY`, and for your channels
`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_ACCOUNTS` (the entry
`youtube-cli login --print` prints).

### Claude Code

```bash
claude mcp add youtube -- npx -y @thenavidm/youtube-mcp-cli@latest
```

With credentials in the environment instead:

```bash
claude mcp add youtube \
  -e YOUTUBE_API_KEY=your-key \
  -e YOUTUBE_CLIENT_ID=your-client-id \
  -e YOUTUBE_CLIENT_SECRET=your-client-secret \
  -e YOUTUBE_REFRESH_TOKEN=your-refresh-token \
  -- npx -y @thenavidm/youtube-mcp-cli@latest
```

Run `/mcp` inside Claude Code and `youtube` should be listed. Remove it later
with `claude mcp remove youtube`.

### Claude Desktop

The quickest route is the extension: download the
[`.mcpb`](https://github.com/thenavidm/youtube-mcp-cli/releases/latest) and
double-click it. It carries its own dependencies and asks for your API key and
channels in a form, so there is no config file to edit.

To wire it up by hand instead, open **Settings**, then **Developer**, then
**Edit Config**. That reveals `claude_desktop_config.json`. Or go straight there:

| System | Config file |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

On macOS, `open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json`
opens it in TextEdit.

If the file is empty, paste all of this. If you ran `youtube-cli login`, drop
the `env` block:

```json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "@thenavidm/youtube-mcp-cli@latest"],
      "env": {
        "YOUTUBE_API_KEY": "your-key"
      }
    }
  }
}
```

If the file already has other servers, add only the `"youtube"` block inside
`"mcpServers"` and put a comma after the entry before it. One bad comma stops
every server loading, not just this one.

Then quit Claude Desktop completely and reopen it. On macOS use **Cmd+Q**,
closing the window is not enough. It only reads that file at startup.

To confirm, open a new chat, click the tools icon and look for `youtube`, then
ask: _"list the caption languages of https://youtu.be/dQw4w9WgXcQ"_.

> [!TIP]
> Claude Desktop does not inherit your shell PATH, so if `npx` is not found, run
> `which npx` and use that absolute path as `command`.

When it does not show up, the log says why:

| System | Log |
|---|---|
| macOS | `tail -f ~/Library/Logs/Claude/mcp*.log` |
| Windows | `%APPDATA%\Claude\logs\` |

The two usual causes are Node not being on the PATH the app sees, which the tip
above fixes, and malformed JSON, which a missing or extra comma causes.

### Cursor

Edit `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` inside one:

```json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "@thenavidm/youtube-mcp-cli@latest"]
    }
  }
}
```

Then reload the window: **Cmd+Shift+P**, **Developer: Reload Window**. The
server appears under **Settings > MCP**.

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`, with the same `mcpServers` block as
Cursor. Then press the refresh button in the MCP panel, or restart Windsurf.

### VS Code

Run **MCP: Add Server** from the command palette, or create `.vscode/mcp.json`
in a project:

```json
{
  "servers": {
    "youtube": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thenavidm/youtube-mcp-cli@latest"]
    }
  }
}
```

VS Code shows a **Start** link above the entry. Click it, then open Copilot Chat
in agent mode and the tools are listed.

### Anything else

Zed, Cline, Continue and any other MCP client over stdio all work. They each
want the same three things: `command` (`npx`), `args`
(`["-y", "@thenavidm/youtube-mcp-cli@latest"]`), and `env`.

### Docker

No image is published, so build it yourself. The image includes `yt-dlp`.

```bash
git clone https://github.com/thenavidm/youtube-mcp-cli.git && cd youtube-mcp-cli
docker build -t youtube-mcp-cli .
docker run -i --rm -e YOUTUBE_API_KEY=your-key youtube-mcp-cli
```

A container cannot read the channels you saved on the host, so pass them as
`YOUTUBE_ACCOUNTS`, with `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.

### Self-hosted over HTTP

For a machine that is always on:

```bash
YOUTUBE_HTTP_TOKEN=a-long-random-string youtube-mcp --http --port=8787
```

It binds to `127.0.0.1` and serves `/health`. To reach it from elsewhere, set
`YOUTUBE_HTTP_HOST=0.0.0.0` together with `YOUTUBE_HTTP_TOKEN`, and put it
behind TLS.

> [!CAUTION]
> The HTTP transport holds live credentials for your channels. A connected
> refresh token can delete videos. Binding it beyond localhost without a token
> hands your channels to anyone who finds the port.

## 5. Check it worked 🩺

```bash
youtube-cli doctor
```

Or, without a global install, `npx -y @thenavidm/youtube-mcp-cli@latest doctor`.

It reports each layer separately, transcripts, the API key, then every channel
by name, so you can see how far you got.

Two failures happen far more than the rest. **`yt-dlp not found`** means
transcripts cannot work until you install it, though everything else still will.
**`unauthorized_client`** on a channel means that token was issued by a different
OAuth client than the one used now, which reads like a revoked grant but is
not: check the client before reconnecting anything.

## 6. Which surface, and what each costs 💰

Both surfaces are the same program with the same 16 tools. The
difference is when the model pays for them. Measured in Claude Code:

| Cost | MCP server | CLI |
|---|---|---|
| Every message, with every tool loaded | 4,500 tokens | nothing |
| Every message, Claude Code's default | 490 tokens | nothing |
| When YouTube comes up | nothing more, or the tools it picks | 2,350 tokens for `SKILL.md`, once |
| 20 messages with YouTube in 1, every tool loaded | 90,000 tokens | 2,350 tokens |

Claude Code's [tool search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)
is on by default: it sends only the tool names and the server instructions,
and loads a tool's full definition when the model reaches for it. An app that
loads every tool up front pays the first line on every message, whether
YouTube comes up or not. With the skill added, Claude Code also lists its
one-line description, about 160 tokens.

To spend less, turn the server off when you are not using it, which in Claude
Code is the `/mcp` panel. `YOUTUBE_READ_ONLY=1` takes the 3 write tools off the list, leaving 13.
Or install the CLI and add the server on the days it earns its place.

Measured on 2026-10-05 with Claude Code 2.1.286 on Claude Opus 5.5: one
short prompt with and without the server connected, once with
`ENABLE_TOOL_SEARCH=false` and once with the default, the difference read
from the API's own usage figures. `SKILL.md` was measured the same way. Other
apps and models count tokens a little differently.

Against 2.0.0, measured the same day: every tool loaded costs 4,458 tokens
instead of 4,984, tool search 489 instead of 493, and `SKILL.md` 93 more,
because it now says how approval works over MCP and lists every exit code. In
Codex 0.159.3 on gpt-6.1-sol, the same task, "find the command that scores a
channel's recent videos against that channel's own median, and the flags it
requires", read a median of 83,295 input tokens on 3.0.0 against 83,565 on
2.0.0 over the CLI, five runs each: Codex now asks `which` instead of reading
the full command list, and the general help is shorter. Over MCP, Codex prints
the tool list with a script and answers from that printout, 6,133 tokens on
3.0.0 against 6,126; the 7 more are the description of `confirm` on the two
irreversible tools. The input totals, a median of 45,053 against 44,924, also
carry the model's reasoning into its second request, which three of the five
2.0.0 runs skipped; the two that kept it read 45,065 and 45,074.

## 7. Tools 🛠️

Every tool is also a command: the tool name with dashes. `*` marks a write, `!`
one that needs `--confirm` in the terminal or `confirm: true` through MCP.

### Transcripts

No credentials. Reads any public video.

| Command | MCP tool | What it does |
|---|---|---|
| `get-transcript` | `get_transcript` | The full transcript, as prose or timestamped lines |
| `list-transcript-languages` | `list_transcript_languages` | Every caption language, and whether it is auto-generated |
| `search-transcript` | `search_transcript` | Find a phrase, get timestamps that link to the second |
| `get-transcripts` | `get_transcripts` | Up to 20 videos in one call |

### Research

Needs an API key. Reads anyone's public data.

| Command | MCP tool | What it does |
|---|---|---|
| `search-videos` | `search_videos` | Search, with view counts and duration joined on |
| `get-channel` | `get_channel` | Subscribers, total views, video count, uploads playlist |
| `analyze-channel` | `analyze_channel` | Recent videos scored against that channel's own median |
| `get-video` | `get_video` | Full detail for one video |

### Your channels

Needs `youtube-cli login`. `list-comments` also works on any public video with
just an API key.

| Command | MCP tool | What it does |
|---|---|---|
| `list-accounts` | `list_accounts` | Every connected channel |
| `get-my-channel` | `get_my_channel` | Your exact subscriber count, not the rounded public one |
| `get-channel-analytics` | `get_channel_analytics` | Watch time, retention, traffic sources, subscriber change |
| `list-my-videos` | `list_my_videos` | Your videos, including private and unlisted |
| `list-comments` | `list_comments` | Comment threads on a video |
| `update-video` * | `update_video` | Title, description, tags, privacy |
| `reply-to-comment` ! | `reply_to_comment` | A public reply |
| `delete-video` ! | `delete_video` | Permanent |

That is 13 read tools and 3 write tools.

### Setup commands

These belong to the command line only, since they are what you run before
anything works.

| Command | What it does |
|---|---|
| `youtube-cli login` | Connect a channel through OAuth. Run once per channel |
| `youtube-cli login --api-key KEY` | Save an API key for search and research |
| `youtube-cli logout <channel>` | Forget a saved channel |
| `youtube-cli doctor` | Check every layer of the setup |

## 8. Output and exit codes 📤

Everything a script needs to branch on.

| Flag | What you get |
|---|---|
| none | compact text for reads, shaped for a model and readable in a terminal |
| `--json` | JSON, always |
| `--compact` | the same JSON on one line |
| `--agent` | compact JSON, no prompts, no color, in one flag |
| `--select a,b.c` | only the named fields of a JSON result, dotted paths descend |

Results go to stdout. Errors go to stderr, always as JSON, so one parse handles
both outcomes. `code` names the kind of failure, and `hint` and `details`, such
as Google's own reason, come along when there is one:

```json
{
  "error": "No API key is configured. Run `youtube-cli login --api-key KEY` or set YOUTUBE_API_KEY for public data, or `youtube-cli login` for your own channels.",
  "code": "not_configured"
}
```

| Code | Means |
|---|---|
| `0` | it worked |
| `1` | an unexpected error |
| `2` | you typed it wrong, an unknown command, a write hidden by `YOUTUBE_READ_ONLY`, or a guarded write refused for want of `--confirm` |
| `3` | not found |
| `4` | authentication failed: reconnect the channel |
| `5` | an API error upstream |
| `7` | rate limited or out of quota: wait |
| `10` | nothing configured: run `youtube-cli login` or `login --api-key`, or install yt-dlp for transcripts |

So a script can tell a mistake it should fix from a failure it should retry:

```bash
youtube-cli list-comments --video-id "$ID" --limit 50 --agent > comments.json
case $? in
  0) ;;
  7) echo "quota or rate limit, retry later" >&2 ;;
  10) echo "run youtube-cli login first" >&2; exit 1 ;;
  *) echo "failed" >&2; exit 1 ;;
esac
```

## 9. Writing safely 🛟

Writes work by default, because managing a channel is the point.

Two tools are guarded: `reply_to_comment`, because it is public the moment it
lands and notifies someone, and `delete_video`, because YouTube removes a video
immediately with no trash and no undo. Both wait for your approval. The CLI goes
through the same guard as the server, so the rules are identical.

Over MCP a person approves each of the two where the client can ask: Claude Code
(2.1.246 and later) shows its own prompt, and a client that can show forms asks
with an approval form whose one box starts unticked. Each approval is signed,
bound to that exact call and works once. Where a client can do neither, the
model's `confirm: true` counts, and it should pass it only when you asked for
that exact reply or delete. `YOUTUBE_CONFIRM=model` makes `confirm: true` enough
everywhere, for an agent with no person to ask. In a terminal it is `--confirm`,
which `--agent` never adds.

`update_video` is not guarded. A title is one keystroke to put back, and asking
to approve reversible things teaches people and models to approve everything
reflexively, which is worse protection than not asking.

| Setting | Effect |
|---|---|
| `YOUTUBE_READ_ONLY=1` | Every write disappears from the tool list and the command list |
| `YOUTUBE_ALLOW_DESTRUCTIVE=0` | `update_video` stays, the two irreversible tools are blocked |
| `YOUTUBE_AUDIT_LOG=<path>` | One JSON line per attempted write, allowed and blocked alike, and who approved it |

Comments, titles, descriptions and transcripts are written by other people. The
tool descriptions and the shipped `SKILL.md` tell the model to treat them as
data, never as instructions. Keep that in mind before wiring this into anything
that runs unattended.

## 10. Several channels 📺

### Set them up

Run `youtube-cli login` once per channel, picking a different one in Google's
chooser each time. Brand channels on the same Google account show up there too.

```bash
youtube-cli login        # your main channel
youtube-cli login        # the clips channel
youtube-cli list-accounts
```

Each one is saved to `~/.youtube-mcp-cli/channels.json` with the OAuth client
that connected it, so channels connected through different clients still work
side by side.

### Using them

Pass `--account` in the terminal, or `account` through MCP:

```bash
youtube-cli list-my-videos --account thenavidm
youtube-cli get-channel-analytics --account clips --start-date 2026-08-01 --end-date 2026-08-31
```

With two or more connected, every account command refuses without it and names
the choices. That is deliberate: acting on the wrong channel is not something
you can take back, so nothing ever picks one for you.

### How a name is matched

The saved name is the channel's handle without the `@`, or its title when it
has no handle. `--account` matches that exactly first, then the channel title,
then a partial match, so `--account navid` finds `thenavidm` when nothing else
does.

### Channels from the environment

`YOUTUBE_ACCOUNTS` (a JSON array) or `YOUTUBE_REFRESH_TOKEN` (one channel) still
work, for a container or another machine. They are read alongside the saved
ones, and an environment channel wins over a saved one with the same name.

`youtube-cli logout <name>` forgets a saved channel. Revoke it at
[Google Account permissions](https://myaccount.google.com/permissions) to cut
access completely.

## 11. Notes and gotchas ⚠️

- **YouTube stopped serving caption text directly.** The track URL now answers
  200 with an empty body unless the request carries a proof-of-origin token. The
  language list still comes from the watch page; the text comes through `yt-dlp`.
  That is why it is a dependency rather than a nicety.
- **Search has its own daily allowance.** 100 calls a day, separate from the
  10,000-unit pool the other endpoints share. It is almost always search that
  runs out first, so do not call it speculatively.
- **Analytics exists only for your own channels.** Watch time, retention and
  traffic sources are not public for anyone else, at any price. No tool here can
  work around that, and a proxy metric would be a worse answer than none.
- **Analytics lags about two days.** An empty result for yesterday usually means
  the data has not landed yet, not that nothing happened.
- **Public subscriber counts are rounded.** YouTube rounds above 1,000 in its
  public API, so `get_channel` and `get_my_channel` disagree on your own channel.
  The second one is exact.
- **`update_video` replaces the whole snippet.** Passing only a title would blank
  the description, so the current values are read back and merged first. This is
  handled, but it is why the tool makes an extra call.
- **A refresh token only works with the client that issued it.** Rebuild the
  OAuth client and every existing token dies with `unauthorized_client`, which
  looks exactly like a revoked grant and sends people reconnecting in circles.
- **Video tags are only visible to the owner.** `get_video` shows them on your
  own videos and returns nothing for anyone else's. The API does this, not a
  permission you are missing.
- **Shorts skew channel analysis.** Their view counts are not comparable to
  long-form on the same channel, so `analyze_channel` flags them rather than
  quietly averaging them in.

## 12. Your data 💾

There is no backend. Every request goes from your machine to Google directly,
and nothing is collected or sent anywhere else.

Two things are written to disk, both only when you ask:

| What | Where | When |
|---|---|---|
| Saved channels and API key | `~/.youtube-mcp-cli/channels.json`, or `YOUTUBE_MCP_HOME` | `youtube-cli login` |
| Audit log | wherever `YOUTUBE_AUDIT_LOG` points | only when set |

The channel file is written 0600 and encrypted with AES-256-GCM under a key
derived from your OS account and this machine, which is never stored. A copied
file is useless elsewhere. It is not a vault: code running as you on this
machine can derive the same key, which is the same exposure as an environment
variable. [SECURITY.md](SECURITY.md) has the detail.

## 13. Troubleshooting 🔧

Run `youtube-cli doctor` first. It checks each layer separately and most answers
are in its output.

| Symptom | Cause |
|---|---|
| `yt-dlp is not installed` | Transcripts need it. `brew install yt-dlp` or `pipx install yt-dlp` |
| Exit code 10, "No API key is configured" | Run `youtube-cli login --api-key KEY`, or set `YOUTUBE_API_KEY` |
| Exit code 10, "No account is configured" | Run `youtube-cli login` for that channel |
| `redirect_uri_mismatch` at login | The OAuth client is a Web client. Use a Desktop app client, or add `http://localhost:8765/callback` |
| `Access blocked` at the consent screen | The channel's Google address is not in **Test users** |
| `unauthorized_client` | The token came from a different OAuth client than the one used now |
| No refresh token returned | Google issues one on first consent only. Revoke at Google Account permissions, then `youtube-cli login` again |
| The token dies after seven days | The app is still in testing. Publish it under **Audience**, or log in again |
| 403, API not enabled | YouTube Data API v3 is off in that Cloud project |
| 403 on captions or comments | The token predates the `force-ssl` scope. Run `youtube-cli login` again |
| `quotaExceeded` | The pool resets at midnight Pacific |
| Search stops working before anything else | Search has its own 100-call daily allowance |
| HTTP 429 on a transcript | YouTube is rate limiting your IP. Waiting is the only fix |
| A command refuses and lists your channels | Two or more are connected. Pass `--account` |
| Every write command has vanished | `YOUTUBE_READ_ONLY=1` is set |
| Server missing in Claude Desktop | Use the absolute path to `npx`, check the JSON, and fully quit the app |
| "will not run without --confirm" | Working as intended: a reply is public and a delete is permanent. See [section 9](#9-writing-safely-) |
| `claude -p` will not reply or delete | Headless Claude Code refuses tools that need a person. Give that agent `YOUTUBE_CONFIRM=model` |
| No approval form appears | The client cannot show forms, so the model's `confirm: true` counts, and only for an action you asked for |
| YouTube asks yt-dlp to prove it is not a bot | Set `YOUTUBE_YTDLP_COOKIES` to a cookies.txt exported from a browser signed in to YouTube |
| A piped request gets no answer | Stdin closed before the answer. The MCP stdio binding stops a server when its input ends; keep stdin open until you read the answer, or use the CLI |

## Environment variables

None are needed for transcripts, and none are needed at all on a machine where
you ran `youtube-cli login`.

**Credentials**

| Variable | Default | What it does |
|---|---|---|
| `YOUTUBE_API_KEY` | the saved key | Public search, channel lookup and comments |
| `YOUTUBE_CLIENT_ID` | none | Your OAuth client, needed by `login` and by env channels |
| `YOUTUBE_CLIENT_SECRET` | none | Its secret |
| `YOUTUBE_OAUTH_CLIENT_ID` | none | The same, under the other common spelling |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | none | The same, under the other common spelling |
| `YOUTUBE_ACCOUNTS` | none | JSON array, several channels at once |
| `YOUTUBE_REFRESH_TOKEN` | none | One channel |
| `YOUTUBE_ACCESS_TOKEN` | none | One channel, short-lived, for testing |
| `YOUTUBE_CHANNEL_NAME` | `default` | What to call that one channel |

**Safety**

| Variable | Default | What it does |
|---|---|---|
| `YOUTUBE_READ_ONLY` | `0` | `1` hides every write |
| `YOUTUBE_ALLOW_DESTRUCTIVE` | `1` | `0` blocks the two irreversible tools |
| `YOUTUBE_AUDIT_LOG` | none | Append-only log of every attempted write, and who approved it |
| `YOUTUBE_CONFIRM` | `human` | `model` lets `confirm: true` alone approve over MCP, for an agent with no person to ask |

**Tuning**

| Variable | Default | What it does |
|---|---|---|
| `YOUTUBE_REQUEST_TIMEOUT_MS` | `30000` | Per-request deadline |
| `YOUTUBE_TRANSCRIPT_LANG` | `en` | Default transcript language |
| `YOUTUBE_YTDLP_PATH` | `yt-dlp` on PATH | Where yt-dlp is |
| `YOUTUBE_YTDLP_COOKIES` | none | A cookies.txt from a browser signed in to YouTube, for when YouTube asks yt-dlp to prove it is not a bot |
| `YOUTUBE_MCP_HOME` | `~/.youtube-mcp-cli` | Where `login` saves channels |
| `YOUTUBE_OAUTH_PORT` | `8765` | The localhost port `login` listens on |
| `YOUTUBE_HTTP_PORT` | `8787` | For `--http` |
| `YOUTUBE_HTTP_HOST` | `127.0.0.1` | For `--http` |
| `YOUTUBE_HTTP_TOKEN` | none | Bearer token for `--http`. Any address but localhost refuses to start without one |
| `YOUTUBE_HTTP_ALLOWED_ORIGINS` | none | Comma-separated browser origins allowed to connect; a page from any other site is refused |
| `YOUTUBE_SURFACE` | `full` | `search` lists three tools that find, describe and run the rest |
| `YOUTUBE_TOOL_TIMEOUT_MS` | none | Give up on any tool after this long |
| `YOUTUBE_DEBUG` | `0` | `1` prints debug lines on stderr |

## Versions

See [CHANGELOG.md](CHANGELOG.md).

## 14. FAQ ❓

<details>
<summary><b>What is an MCP server?</b></summary>

An MCP server is a standard way to give an AI assistant real access to a tool, so
it can act rather than guess. You install it once, your assistant gains the
tools, and it works in Claude, Cursor and anything else speaking MCP.

</details>

<details>
<summary><b>What is the CLI?</b></summary>

`youtube-cli` is the same program as the MCP server, run as commands. AI agents that run commands, like Claude Code, Codex and OpenCode, use it on their own, and you can type the same commands in a terminal, a script or a cron job. Every tool is a command with dashes, so `get_transcript` runs as `youtube-cli get-transcript`.

</details>

<details>
<summary><b>Should I use the MCP server or the CLI?</b></summary>

Use the MCP server in an app with no terminal, like Claude Desktop's chat. Use the CLI anywhere commands run: an agent like Claude Code, Codex or OpenCode, a script or a cron job. The MCP server's tools take up context on every message, and the CLI costs nothing until it runs.

</details>

<details>
<summary><b>What is the YouTube Data API?</b></summary>

The YouTube Data API is Google's official interface to YouTube, covering videos,
channels, playlists and comments. It is what this uses for everything except
transcripts, which the API does not offer for videos you do not own.

</details>

<details>
<summary><b>Do I need to be technical?</b></summary>

You need to run a command or paste a few lines into a config file. Transcripts
work with no setup whatsoever, so you can install it, try it, and only do the
credential work if you want search or your own channel.

</details>

<details>
<summary><b>Can I connect more than one channel?</b></summary>

You can connect as many as you run. Run `youtube-cli login` once per channel,
and pass `--account` to pick one. With two or more connected the tools refuse to
guess, which is deliberate: acting on the wrong channel is not something you can
take back.

</details>

<details>
<summary><b>Is my data sent anywhere?</b></summary>

Your credentials stay on your machine and go only to Google. There is no
backend, nothing is collected, and nothing phones anywhere. The code is here to
read.

</details>

<details>
<summary><b>What can it do that youtube.com cannot?</b></summary>

It reads the transcript of any public video as text you can search, compare and
feed to a model. The site shows you captions one video at a time. Pulling twenty
transcripts to find what their openings have in common is a minute here and an
afternoon by hand.

</details>

<details>
<summary><b>Can it delete one of my videos by accident?</b></summary>

It cannot delete anything without your approval: Claude Code shows its own
prompt for each delete, a client that can show forms asks with one, and
elsewhere the model has to pass `confirm: true` deliberately after reading a
description saying the action is permanent. If you want the possibility gone
entirely, set `YOUTUBE_READ_ONLY=1` and every write disappears.

</details>

<details>
<summary><b>Does it cost anything?</b></summary>

It costs nothing. The package is MIT, and the YouTube Data API is free within a
daily quota that ordinary use does not come near. Google does not ask for a card.

</details>

<details>
<summary><b>Does it work with ChatGPT and Cursor?</b></summary>

It works with any client that speaks MCP, including Cursor, Windsurf and VS Code.
[Section 4](#4-connect-your-client-) has a block for each one.

</details>

<details>
<summary><b>What happens when my token expires?</b></summary>

Access tokens last an hour and are refreshed automatically, so you will not
notice. A refresh token lasts until you revoke it, with one exception: an OAuth
app still in testing issues refresh tokens that expire after seven days. Publish
the app to stop that, or run `youtube-cli login` again when it happens.

</details>

<details>
<summary><b>Can it reply to a comment without me asking?</b></summary>

It replies when you ask it to. A reply is public the moment it lands and
notifies the person you replied to, so each one waits for your approval in the
client, as a delete does. `YOUTUBE_READ_ONLY=1` removes replying, editing and
deleting from the list entirely.

</details>

<details>
<summary><b>How do I disconnect it?</b></summary>

Remove the server from your client's config, run `youtube-cli logout` for each
channel, and revoke the app at
[Google Account permissions](https://myaccount.google.com/permissions). Deleting
the Cloud project removes the API key and the OAuth client together.

</details>

## Questions

Run into a problem or have a question? [Open an issue](https://github.com/thenavidm/youtube-mcp-cli/issues) and I will help.

## About the author

Navid Moazzez is a leading AI business strategist, and the host of the AI Creator Summit, watched by 100,000+ creators. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. He creates useful free tools, MCP servers and CLIs that creators and founders can use in their own workflows.

**Links**

- Personal website: [navid.me](https://navid.me?utm_source=github&utm_medium=referral&utm_campaign=youtube-mcp-cli&utm_content=readme)
- Link in bio: [navid.bio](https://navid.bio?utm_source=github&utm_medium=referral&utm_campaign=youtube-mcp-cli&utm_content=readme)
- Navid Media: [navid.media](https://navid.media?utm_source=github&utm_medium=referral&utm_campaign=youtube-mcp-cli&utm_content=readme)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

If this is useful, star the repo and come say hi on [X](https://x.com/thenavidm).

## Dependencies

| Library | License | What it does |
|---|---|---|
| [Slipway](https://github.com/thenavidm/slipway) | Apache-2.0 | The MCP server and the CLI from one definition of each tool, with the write guard |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Apache-2.0 | The MCP protocol and transports, through Slipway |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool argument schemas and validation |

[yt-dlp](https://github.com/yt-dlp/yt-dlp) is an optional external command, used
only to fetch caption tracks. It is not bundled and is never loaded into this
process.

## License

[MIT](./LICENSE). Free to use, modify, and share.

Not affiliated with, endorsed by, or connected to Google LLC. YouTube is a
trademark of Google LLC.

---

© 2026 [Navid Media](https://navid.media?utm_source=github&utm_medium=referral&utm_campaign=youtube-mcp-cli&utm_content=readme). Made with ❤️ by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=referral&utm_campaign=youtube-mcp-cli&utm_content=readme).
