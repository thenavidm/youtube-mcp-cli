/**
 * YouTube Data + Analytics API client.
 *
 * Two credential paths, and which one you have decides which tools work:
 *
 *   API key:  anyone's public data. Search, channels, public video stats.
 *               No consent screen, no user. Cheapest to set up.
 *   OAuth:    your own channels. Uploads, playlists, comments as the owner,
 *               and Analytics, which has no API-key path at all.
 *
 * Multi-account is the default rather than a feature. A creator with several
 * channels has to be able to say which one an action runs against, so every
 * account-scoped tool takes `account` and the server refuses to guess when
 * more than one is connected.
 */

import type { Account } from "../config.js";

const DATA_BASE = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }

  /** The shape the CLI prints on stderr, so a script parses one thing. */
  toJSON(): { error: string; status: number; reason?: string } {
    return { error: this.message, status: this.status, ...(this.reason ? { reason: this.reason } : {}) };
  }
}

/**
 * Turn Google's error envelope into something a person can act on.
 *
 * The raw messages are unhelpfully generic: "The request cannot be completed
 * because you have exceeded your quota" does not tell you that quota resets at
 * midnight Pacific, and `quotaExceeded` vs `rateLimitExceeded` need different
 * responses from the caller.
 */
function explain(status: number, reason: string | undefined, message: string): string {
  switch (reason) {
    case "quotaExceeded":
      return "Daily API quota is used up. It resets at midnight Pacific. Raise it in the Cloud console under IAM & Admin > Quotas, or wait.";
    case "rateLimitExceeded":
      return "Too many requests too quickly. Slow down and retry.";
    case "forbidden":
    case "insufficientPermissions":
      return `Your token lacks the scope for this call. Reconnect the account and approve every permission. (${message})`;
    case "authError":
    case "unauthorized":
      return "The access token is invalid or expired. Reconnect the account.";
    case "videoNotFound":
    case "channelNotFound":
    case "playlistNotFound":
      return `Not found. Check the id. (${message})`;
    default:
      return status === 403
        ? `${message}. Usually a missing scope or a disabled API in the Cloud project.`
        : message;
  }
}

export type Credentials = {
  apiKey?: string;
  account?: Account;
};

export class YouTubeClient {
  /** Refreshed tokens live here for the process lifetime, keyed by account id. */
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly creds: Credentials) {}

  /** An access token for the account, refreshing when it is within a minute of expiry. */
  private async accessToken(account: Account): Promise<string> {
    const cached = this.tokenCache.get(account.id);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    if (!account.refreshToken) {
      if (!account.accessToken) {
        throw new YouTubeApiError(
          `Account "${account.name}" has no credentials. Reconnect it.`,
          401,
          "authError",
        );
      }
      return account.accessToken;
    }

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
        client_id: account.clientId,
        client_secret: account.clientSecret,
      }).toString(),
    });

    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !body.access_token) {
      // `unauthorized_client` here nearly always means the refresh token was
      // issued by a different OAuth client than the one configured now, not
      // that the user revoked access. Say so, because the two look identical
      // from the outside and lead to opposite fixes.
      const hint =
        body.error === "unauthorized_client"
          ? " This usually means the token was issued by a different OAuth client than the one configured. Check YOUTUBE_CLIENT_ID matches the client that authorized this channel, or reconnect."
          : "";
      throw new YouTubeApiError(
        `Could not refresh "${account.name}": ${body.error ?? res.status}${body.error_description ? ` (${body.error_description})` : ""}.${hint}`,
        401,
        "authError",
      );
    }

    this.tokenCache.set(account.id, {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    });
    return body.access_token;
  }

  private async request<T>(
    base: string,
    path: string,
    params: Record<string, unknown>,
    init: { method?: string; body?: unknown; requireAuth?: boolean } = {},
  ): Promise<T> {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {};
    const account = this.creds.account;

    if (account) {
      headers.Authorization = `Bearer ${await this.accessToken(account)}`;
    } else if (init.requireAuth) {
      // A plain Error, not a 401: nothing was rejected, nothing was set up. The
      // CLI maps "no ... is configured" to exit 10, which is what a script needs
      // to tell "run login first" apart from "your token expired".
      throw new Error(
        "No account is configured for this action. Run `youtube-cli login` once per channel, or set YOUTUBE_ACCOUNTS.",
      );
    } else if (this.creds.apiKey) {
      url.searchParams.set("key", this.creds.apiKey);
    } else {
      throw new Error(
        "No API key is configured. Run `youtube-cli login --api-key KEY` or set YOUTUBE_API_KEY for public data, or `youtube-cli login` for your own channels.",
      );
    }

    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      const err = (data as { error?: { message?: string; errors?: { reason?: string }[] } }).error;
      const reason = err?.errors?.[0]?.reason;
      throw new YouTubeApiError(
        explain(res.status, reason, err?.message ?? text),
        res.status,
        reason,
      );
    }
    return data as T;
  }

  get<T>(path: string, params: Record<string, unknown> = {}, requireAuth = false): Promise<T> {
    return this.request<T>(DATA_BASE, path, params, { requireAuth });
  }

  post<T>(path: string, params: Record<string, unknown>, body: unknown): Promise<T> {
    return this.request<T>(DATA_BASE, path, params, { method: "POST", body, requireAuth: true });
  }

  put<T>(path: string, params: Record<string, unknown>, body: unknown): Promise<T> {
    return this.request<T>(DATA_BASE, path, params, { method: "PUT", body, requireAuth: true });
  }

  delete<T>(path: string, params: Record<string, unknown>): Promise<T> {
    return this.request<T>(DATA_BASE, path, params, { method: "DELETE", requireAuth: true });
  }

  analytics<T>(params: Record<string, unknown>): Promise<T> {
    return this.request<T>(ANALYTICS_BASE, "/reports", params, { requireAuth: true });
  }
}

/** ISO 8601 durations (`PT4M13S`) are unreadable in output. Seconds are not. */
export function durationToSeconds(iso?: string): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  return (
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3] ?? 0) * 60 +
    Number(m[4] ?? 0)
  );
}
