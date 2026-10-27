import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resolveAccount, type Config } from "../src/config.js";

const KEYS = [
  "YOUTUBE_API_KEY",
  "YOUTUBE_ACCOUNTS",
  "YOUTUBE_REFRESH_TOKEN",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_CHANNEL_NAME",
  "YOUTUBE_READ_ONLY",
];

// Before as well as after: a shell that exports a real client id must not leak into the first test.
const clear = () => {
  for (const k of KEYS) delete process.env[k];
};
beforeEach(clear);
afterEach(clear);

const base = (accounts: Config["accounts"]): Config => ({
  accounts,
  readOnly: false,
  allowDestructive: true,
  requestTimeoutMs: 30000,
  defaultLanguage: "en",
});

describe("OAuth client resolution", () => {
  // A refresh token only works against the client that issued it, so accepting
  // one spelling and ignoring the other produces an `unauthorized_client` that
  // looks exactly like a revoked grant. This is the regression that caused it.
  it("accepts either spelling of the client id", () => {
    process.env.YOUTUBE_OAUTH_CLIENT_ID = "oauth-spelling";
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "token";
    expect(loadConfig().accounts[0]?.clientId).toBe("oauth-spelling");
  });

  it("prefers the plain spelling when both are set", () => {
    process.env.YOUTUBE_CLIENT_ID = "plain";
    process.env.YOUTUBE_CLIENT_SECRET = "secret";
    process.env.YOUTUBE_OAUTH_CLIENT_ID = "oauth-spelling";
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "other";
    process.env.YOUTUBE_REFRESH_TOKEN = "token";
    expect(loadConfig().accounts[0]?.clientId).toBe("plain");
  });
});

describe("loadConfig", () => {
  it("connects no accounts when there are no credentials", () => {
    expect(loadConfig().accounts).toHaveLength(0);
  });

  it("reads several channels out of YOUTUBE_ACCOUNTS", () => {
    process.env.YOUTUBE_ACCOUNTS = JSON.stringify([
      { name: "Main", refresh_token: "a" },
      { name: "Clips", refresh_token: "b" },
    ]);
    const accounts = loadConfig().accounts;
    expect(accounts.map((a) => a.name)).toEqual(["Main", "Clips"]);
  });

  it("explains itself when YOUTUBE_ACCOUNTS is not JSON", () => {
    process.env.YOUTUBE_ACCOUNTS = "not json";
    expect(() => loadConfig()).toThrow(/valid JSON/);
  });
});

describe("resolveAccount", () => {
  const accounts = [
    { id: "main", name: "Main", clientId: "c", clientSecret: "s", refreshToken: "a" },
    { id: "clips", name: "Clips", clientId: "c", clientSecret: "s", refreshToken: "b" },
  ];

  it("returns the only account when there is one", () => {
    expect(resolveAccount(base([accounts[0]!])) ?.name).toBe("Main");
  });

  // Defaulting to "the first one" is how an agent uploads to the wrong channel,
  // and that is not recoverable. It has to refuse instead.
  it("refuses to guess between several and lists the choices", () => {
    expect(() => resolveAccount(base(accounts))).toThrow(/Main, Clips/);
  });

  it("matches by name, by handle and by partial name", () => {
    expect(resolveAccount(base(accounts), "Clips")?.name).toBe("Clips");
    expect(resolveAccount(base(accounts), "@clips")?.name).toBe("Clips");
    expect(resolveAccount(base(accounts), "cli")?.name).toBe("Clips");
  });

  it("names the connected channels when the requested one is not there", () => {
    expect(() => resolveAccount(base(accounts), "nope")).toThrow(/Main, Clips/);
  });
});
