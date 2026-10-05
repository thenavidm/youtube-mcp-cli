/**
 * Configuration.
 *
 * Channels come from two places, and both are read on every start:
 *
 *   YOUTUBE_ACCOUNTS       JSON array, several channels at once
 *   YOUTUBE_REFRESH_TOKEN  one channel
 *   ~/.youtube-mcp-cli/    every channel saved by `youtube-cli login`
 *
 * An env channel wins over a saved one with the same id, so a client config can
 * always override the store. The API key is YOUTUBE_API_KEY, else the one saved
 * by `youtube-cli login --api-key`. Transcripts need none of these.
 */

import { loadStore, type Store } from "./accounts/store.js";
import { NotConfiguredError, UsageError } from "@thenavidm/slipway";

export type Account = {
  /** Stable key used by the `account` tool parameter. Channel handle or name. */
  id: string;
  name: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
};

export type Config = {
  apiKey?: string;
  accounts: Account[];
  readOnly: boolean;
  /** Block uploads, deletes and anything else that cannot be undone. */
  allowDestructive: boolean;
  requestTimeoutMs: number;
  defaultLanguage: string;
  /** Append-only JSON-lines record of every attempted write. */
  auditPath?: string;
};

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

/**
 * Both spellings of the OAuth client are accepted.
 *
 * `YOUTUBE_CLIENT_ID` and `YOUTUBE_OAUTH_CLIENT_ID` are both in wide use and
 * people reasonably expect either to work. A refresh token only ever works
 * against the client that issued it, so accepting one spelling and silently
 * ignoring the other produces an `unauthorized_client` that looks like a
 * revoked grant. Read both.
 */
function oauthClient(): { id: string; secret: string } {
  const id = (process.env.YOUTUBE_CLIENT_ID ?? process.env.YOUTUBE_OAUTH_CLIENT_ID ?? "").trim();
  const secret = (
    process.env.YOUTUBE_CLIENT_SECRET ??
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET ??
    ""
  ).trim();
  return { id, secret };
}

/** Env channels first, then saved ones whose id the env has not already claimed. */
function parseAccounts(store: Store): Account[] {
  const fromEnv = envAccounts();
  const saved = store.channels
    .filter((c) => c.refresh_token && !fromEnv.some((e) => e.id === c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      clientId: c.client_id,
      clientSecret: c.client_secret,
      refreshToken: c.refresh_token,
    }));
  return [...fromEnv, ...saved];
}

function envAccounts(): Account[] {
  const { id: defaultId, secret: defaultSecret } = oauthClient();

  const raw = process.env.YOUTUBE_ACCOUNTS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new NotConfiguredError(
        "YOUTUBE_ACCOUNTS is not valid JSON. It should be an array like " +
          '[{"name":"Main","refresh_token":"1//..."}].',
      );
    }
    if (!Array.isArray(parsed)) throw new NotConfiguredError("YOUTUBE_ACCOUNTS must be a JSON array.");

    return parsed.map((entry, i) => {
      const a = entry as Record<string, string | undefined>;
      const name = a.name ?? a.account_name ?? a.channel ?? `account-${i + 1}`;
      return {
        id: (a.id ?? name).toLowerCase().replace(/^@/, ""),
        name,
        clientId: a.client_id ?? defaultId,
        clientSecret: a.client_secret ?? defaultSecret,
        refreshToken: a.refresh_token,
        accessToken: a.access_token,
      };
    });
  }

  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN?.trim();
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN?.trim();
  if (!refreshToken && !accessToken) return [];

  const name = process.env.YOUTUBE_CHANNEL_NAME?.trim() || "default";
  return [
    {
      id: name.toLowerCase().replace(/^@/, ""),
      name,
      clientId: defaultId,
      clientSecret: defaultSecret,
      refreshToken,
      accessToken,
    },
  ];
}

export function loadConfig(): Config {
  const store = loadStore();
  return {
    apiKey: process.env.YOUTUBE_API_KEY?.trim() || store.api_key || undefined,
    accounts: parseAccounts(store),
    readOnly: bool(process.env.YOUTUBE_READ_ONLY, false),
    allowDestructive: bool(process.env.YOUTUBE_ALLOW_DESTRUCTIVE, true),
    requestTimeoutMs: Number(process.env.YOUTUBE_REQUEST_TIMEOUT_MS ?? 30000),
    defaultLanguage: process.env.YOUTUBE_TRANSCRIPT_LANG?.trim() || "en",
    auditPath: process.env.YOUTUBE_AUDIT_LOG?.trim() || undefined,
  };
}

/**
 * Resolve the `account` tool parameter to one connected channel.
 *
 * With two or more channels connected and no choice made, this throws rather
 * than defaulting. Defaulting to "the first one" is how an agent silently
 * uploads to the wrong channel, and that is not recoverable.
 */
export function resolveAccount(config: Config, requested?: string): Account | undefined {
  const { accounts } = config;
  if (accounts.length === 0) return undefined;

  if (requested) {
    const want = requested.toLowerCase().replace(/^@/, "").trim();
    const match =
      accounts.find((a) => a.id === want || a.name.toLowerCase() === want) ??
      accounts.find((a) => a.name.toLowerCase().includes(want) || a.id.includes(want));
    if (!match) {
      throw new UsageError(
        `No connected channel matches "${requested}". Connected: ${accounts.map((a) => a.name).join(", ")}. Call list_accounts to see them.`,
      );
    }
    return match;
  }

  if (accounts.length > 1) {
    throw new UsageError(
      `${accounts.length} channels are connected (${accounts.map((a) => a.name).join(", ")}). Pass account=<name or @handle> so this runs against the right one.`,
    );
  }
  return accounts[0];
}
