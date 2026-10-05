# Security

## Reporting a vulnerability

Report it privately through
[GitHub security advisories](https://github.com/thenavidm/youtube-mcp-cli/security/advisories/new),
not as a public issue.

## What this holds

There is no backend. Every request goes from your machine to Google directly.

Credentials live in one of two places, and you choose which:

- **Your MCP client's config and this process's environment**, when you set the
  `YOUTUBE_*` variables.
- **`~/.youtube-mcp-cli/channels.json`**, when you run `youtube-cli login`. It
  holds the refresh token and OAuth client for each channel you connect, plus
  the API key if you saved one with `login --api-key`. The file is written 0600
  in a 0700 directory and encrypted with AES-256-GCM under a key derived from
  this OS account and this machine, which is never stored.

Be clear about what that encryption buys. A copied file is useless on another
machine, and a casual read of a disk or a backup sees ciphertext. It is not a
vault: code running as you on this machine can derive the same key. That is the
same exposure as an environment variable, which is why env vars stay fully
supported. `YOUTUBE_MCP_HOME` moves the file.

A connected refresh token reaches a real channel. It can read private videos,
edit titles, post public comments and delete videos. Treat it like a password.
`youtube-cli logout` removes a channel from the file, but the token keeps working
until you revoke it at
[Google Account permissions](https://myaccount.google.com/permissions).

`youtube-cli login` prints no token unless you pass `--print`.

## The write-safety model

Writes work by default, because managing a channel is the point of the tool.
There are 13 read tools and 3 that write.

`reply_to_comment` and `delete_video` wait for your approval, because neither can
be taken back. Over MCP a person approves each where the client can ask: Claude
Code shows its own prompt, and a client that can show forms asks with one. Each
approval is signed, bound to that exact call and works once. Where a client can
do neither, the model must pass `confirm: true`, and `YOUTUBE_CONFIRM=model`
allows that everywhere. In the terminal it is `--confirm`. The CLI goes through
the same guard as the server, so the rules are identical on both surfaces.
`update_video` needs none of this, because it is reversible.

`YOUTUBE_READ_ONLY=1` removes every write tool from the list rather than failing
at call time. Use it when pointing an agent you do not fully trust at a real
channel.

`YOUTUBE_ALLOW_DESTRUCTIVE=0` keeps the reversible write and blocks the two
irreversible ones outright.

`YOUTUBE_AUDIT_LOG=<path>` appends one JSON line per attempted write, allowed and
blocked alike, with who approved it.

## Running it over HTTP

`--http` binds to `127.0.0.1` unless `YOUTUBE_HTTP_HOST` says otherwise, and will
not start on any other address without `YOUTUBE_HTTP_TOKEN`, which it then
requires as a bearer token. Without one, anyone who can reach the port could act
on every connected channel. It also refuses a request from a page on another
site unless `YOUTUBE_HTTP_ALLOWED_ORIGINS` lists it.

There is no TLS here. Put it behind a reverse proxy that terminates it.

## Untrusted input

Video descriptions, titles, transcripts and comments are written by other people
and can contain text engineered to look like instructions to a model. Tool
descriptions and the shipped `SKILL.md` tell the model to treat that content as
data. Keep that in mind when wiring this into anything that runs unattended.

## Good-faith research

Read, run and pull apart anything here. Nobody but the maintainer can change
this repository, so nothing you do while investigating puts it at risk.

The care is owed to the service the tool talks to, not to the code. When
testing, use your own account and your own data. Do not point it at somebody
else's, and do not hammer a shared API to the point where other people notice.
If a test could affect anyone but you, stop and send a private report first.

Research done in that spirit is welcome, and nothing here is a trap.
