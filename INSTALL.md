# Install

The long version. The [README](README.md) has the short one, plus every MCP
client's config in [section 4](README.md#4-connect-your-client-).

| | Section | |
|---|---|---|
| 1 | [Install the package](#1-install-the-package) | npx, a global install, or from source |
| 2 | [What you actually need](#2-what-you-actually-need) | Three levels, most people stop at one |
| 3 | [Make a Google Cloud project](#3-make-a-google-cloud-project) | Free, no card |
| 4 | [Turn on the APIs](#4-turn-on-the-apis) | Data API, and Analytics if you want it |
| 5 | [Get an API key](#5-get-an-api-key) | Search, channels, comments on any video |
| 6 | [Set up the consent screen](#6-set-up-the-consent-screen) | Only for your own channels |
| 7 | [Create the OAuth client](#7-create-the-oauth-client) | Desktop app, even on a server |
| 8 | [Connect each channel](#8-connect-each-channel) | `youtube-cli login`, once per channel |
| 9 | [Check it worked](#9-check-it-worked) | `doctor` |
| 10 | [Upgrading and removing](#10-upgrading-and-removing) | And revoking access |
| 11 | [The failures worth knowing in advance](#11-the-failures-worth-knowing-in-advance) | Before they cost you an hour |

Everything in sections 3 to 8 happens in your own Google Cloud project. There is
no shared key to borrow: quota is counted per project and an OAuth client only
works with the tokens it issued itself, so every user runs their own. It is free.

Console labels were checked against Google's own documentation in September
2026. Google renames things, so if a label has moved, the goal of each step
still holds.

## 1. Install the package

Node 20 or newer.

For an MCP client you install nothing: the client runs it through `npx`, which
fetches it on demand, so there is nothing to update later.

```bash
npx -y @thenavidm/youtube-mcp-cli@latest --version
```

For the command line, install it globally. That puts two commands on your PATH:
`youtube-cli`, the one you type, and `youtube-mcp`, the server your AI tools
launch. They are one program.

```bash
npm install -g @thenavidm/youtube-mcp-cli
youtube-cli
```

From source, if you want to run a checkout:

```bash
git clone https://github.com/thenavidm/youtube-mcp-cli.git
cd youtube-mcp-cli
npm install && npm run build
node dist/index.js --version
```

Transcripts also need `yt-dlp`, because YouTube stopped serving caption text
directly:

```bash
brew install yt-dlp        # macOS
pipx install yt-dlp        # everywhere else
```

## 2. What you actually need

Work out which of these you want before starting, because the third one takes
longer and plenty of people never need it.

**Nothing at all** gets you transcripts, on any public video. If that is all you
came for, stop here. It already works.

**An API key** gets you search, channel lookup, `analyze_channel` and the
comments on any public video. About ten minutes: sections 3 to 5.

**An OAuth client** gets you your own channels: private and unlisted videos,
Analytics, comment replies and video edits. About half an hour, most of it
forms: sections 3, 4, 6, 7 and 8.

## 3. Make a Google Cloud project

Go to the [Google Cloud console](https://console.cloud.google.com). Create a
project from the project picker in the top bar and give it a name only you will
read.

A project is a billing and quota boundary, not a product. Nothing here costs
money, and the YouTube Data API does not ask for a card.

## 4. Turn on the APIs

In **APIs & Services > Library**, enable:

- **YouTube Data API v3** for everything
- **YouTube Analytics API** only if you want watch time and retention

An API that is off returns 403 with a message about the API not being enabled
for the project. If a call fails that way, this is the step that was missed.

## 5. Get an API key

In **APIs & Services > Credentials**, choose **Create credentials > API key**.
Copy it.

Restrict it before you leave the page. Click **Restrict key**, and under API
restrictions allow only the YouTube APIs you enabled. An unrestricted key that
leaks can be spent against everything in the project.

Save it, and search and research work from then on, in the terminal and in
every MCP client on this machine:

```bash
youtube-cli login --api-key AIza...
```

Or set it as an environment variable instead, which is what a client config on
another machine needs:

```bash
YOUTUBE_API_KEY=AIza...
```

## 6. Set up the consent screen

Only needed for your own channels. Skip it if the API key is enough.

Go to **Google Auth platform > Branding** and click **Get Started**.

- **App information**: an app name only you will see, and your address under
  **User support email**
- **Audience**: choose **External**. Internal is for Workspace organizations
  only, and a YouTube channel usually sits on an ordinary Google account
- **Contact information**: your address again
- **Finish**: agree to the user data policy, then **Create**

Then open **Audience**. Under **Test users**, click **Add users** and add the
Google address that owns each channel you plan to connect.

**This is the step people skip, and it is the one that blocks them.** An
External app stays in testing until Google verifies it, and an app in testing
only issues tokens to addresses on that list. Miss it and authorization fails
with a message about the app being blocked, which reads like your account is at
fault when it is not.

You do not need to submit for verification. Verification is for handing an app
to strangers. Do click **Publish app** under **Audience**, though: an app left in
testing issues refresh tokens that expire after seven days. Keep the test users
listed either way.

## 7. Create the OAuth client

Go to **Google Auth platform > Clients** and click **Create Client**.

Under **Application type** choose **Desktop app**, name it, and click
**Create**.

Desktop app is right even if you will run this on a server. It is the type that
issues a client secret and accepts the `http://localhost:8765/callback` redirect
that `youtube-cli login` catches. If you use a Web application client instead,
add exactly that address under **Authorized redirect URIs**, or login fails with
`redirect_uri_mismatch`.

Copy the client ID and the client secret:

```bash
export YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
export YOUTUBE_CLIENT_SECRET=...
```

## 8. Connect each channel

```bash
youtube-cli login
```

A browser opens. Pick the Google account and the channel, approve, and the
channel is saved:

```
Connected: Navid Moazzez (@thenavidm)
Saved to ~/.youtube-mcp-cli/channels.json, encrypted and 0600. 1 channel connected.
```

**Run it once per channel.** Each run adds one, and a channel you connect again
replaces its old entry rather than duplicating it. Brand channels on the same
Google account show up in Google's channel chooser.

Then check what is connected, and use one by name:

```bash
youtube-cli list-accounts
youtube-cli list-my-videos --account thenavidm
```

The name is the channel's handle without the `@`, or its title when it has no
handle. With two or more connected, every account command needs `--account`
and refuses to guess, because acting on the wrong channel is not recoverable.

A few variations:

| You want | Run |
|---|---|
| The client on the command line instead of in env | `youtube-cli login --client-id ... --client-secret ...` |
| The env entry too, for a machine without the file | `youtube-cli login --print` |
| A different port than 8765 | `YOUTUBE_OAUTH_PORT=9000 youtube-cli login`, and add that redirect URI |
| The file somewhere else | `YOUTUBE_MCP_HOME=/path youtube-cli login` |
| To forget a channel | `youtube-cli logout thenavidm` |
| To forget the API key | `youtube-cli logout --api-key` |

The file is encrypted with a key derived from this machine and your account, so
a copy is useless anywhere else. The MCP server reads it too, so a client on
this machine needs no credentials in its config at all.

For a machine where the file cannot live, such as a container or a server
another user runs, set the channels in the environment instead. `login --print`
gives you the entry:

```bash
YOUTUBE_ACCOUNTS='[{"name":"Main","refresh_token":"1//..."},{"name":"Clips","refresh_token":"1//..."}]'
```

For a single channel, `YOUTUBE_REFRESH_TOKEN=1//...` is enough. An environment
channel wins over a saved one with the same name.

## 9. Check it worked

```bash
youtube-cli doctor
```

It reports each layer separately: transcripts, the API key, then every connected
channel by name. So you can see exactly how far you got.

## 10. Upgrading and removing

Through `npx`, the `@latest` tag picks up new versions on the next start. A
global install upgrades with the same command that installed it:

```bash
npm install -g @thenavidm/youtube-mcp-cli@latest
```

To remove it completely:

1. Remove the server from your client's config.
2. `npm uninstall -g @thenavidm/youtube-mcp-cli`
3. Delete `~/.youtube-mcp-cli`.
4. Revoke the app at [Google Account permissions](https://myaccount.google.com/permissions).
   Deleting the file does not revoke anything: a refresh token keeps working
   until you do this.

## 11. The failures worth knowing in advance

**`redirect_uri_mismatch` at login.** The OAuth client is a Web application
without `http://localhost:8765/callback` in its redirect URIs. Add it, or create
a Desktop app client as section 7 says.

**`unauthorized_client` on refresh.** The token was issued by a different OAuth
client than the one used now. It reads exactly like a revoked grant and leads
people to reconnect repeatedly, which does not help. A channel saved by `login`
keeps the client that connected it, so this mostly happens with environment
tokens. If you rebuilt the client, every token it issued is dead and each
channel has to be connected once more.

**No refresh token came back.** Google issues one on first consent only. If this
client was already authorized for that channel, revoke it at
[Google Account permissions](https://myaccount.google.com/permissions) and run
`youtube-cli login` again.

**403 saying the API is not enabled.** Section 4, on the project this client
belongs to. A project with the API off looks identical to a credential problem.

**403 on captions or comment moderation.** Those need the `force-ssl` scope.
Login requests it already, so this means the token predates it. Connect the
channel again.

**The token stops working after a week.** An app still in testing issues refresh
tokens that expire after seven days. Publish the app under **Audience** to stop
that, or run `youtube-cli login` again when it happens.

**Quota exhausted.** The pool resets at midnight Pacific. Search has its own
allowance of 100 calls a day, separate from the 10,000-unit pool everything else
shares, and it is almost always search that runs out first.
