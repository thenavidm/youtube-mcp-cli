/**
 * Where `youtube-cli login` keeps connected channels.
 *
 * One file holds every channel you have connected plus an optional API key, so
 * several channels work without pasting a JSON array into a client config. The
 * file is 0600 and encrypted with AES-256-GCM under a key derived from this OS
 * account plus this machine, which is never stored.
 *
 * Be honest about what that buys: a copied file is useless on another machine,
 * and a casual disk or backup read sees ciphertext. It is machine-binding and
 * obfuscation, not a secret vault. Code running as you on this machine can
 * re-derive the key. That is the same exposure as the environment-variable
 * path, which is why env vars remain a first-class, fully supported option.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";

export type StoredChannel = {
  /** What `--account` matches: the handle without @, else the channel name. */
  id: string;
  name: string;
  handle?: string;
  channel_id?: string;
  /** A refresh token only works with the client that issued it, so each channel keeps its own. */
  client_id: string;
  client_secret: string;
  refresh_token: string;
  connected_at: string;
};

export type Store = {
  channels: StoredChannel[];
  api_key?: string;
};

const MAGIC = "YTMCP1";

export function storeHome(): string {
  return process.env.YOUTUBE_MCP_HOME || join(homedir(), ".youtube-mcp-cli");
}

export function storePath(): string {
  return join(storeHome(), "channels.json");
}

/** Derived from stable machine and account facts. Never written anywhere. */
function deriveKey(salt: Buffer): Buffer {
  const material = `${userInfo().username} ${hostname()} youtube-mcp-cli`;
  return scryptSync(material, salt, 32);
}

/** The saved channels, or an empty store when there is no file or it will not decrypt. */
export function loadStore(): Store {
  const path = storePath();
  if (!existsSync(path)) return { channels: [] };

  try {
    const parts = readFileSync(path, "utf8").trim().split(".");
    if (parts.length !== 5 || parts[0] !== MAGIC) return { channels: [] };
    const [, salt, iv, tag, ciphertext] = parts as [string, string, string, string, string];

    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(Buffer.from(salt, "base64")),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<Store>;
    return {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      api_key: parsed.api_key || undefined,
    };
  } catch {
    // Wrong machine, wrong account, or a corrupt file. Treat it as absent so the
    // env-var path still works rather than failing startup.
    return { channels: [] };
  }
}

export function saveStore(store: Store): string {
  const dir = storeHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(salt), iv);
  const plaintext = Buffer.from(JSON.stringify(store), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const payload = [
    MAGIC,
    salt.toString("base64"),
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");

  const path = storePath();
  writeFileSync(path, payload, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

const matches = (c: StoredChannel, hint: string): boolean => {
  const want = hint.toLowerCase().replace(/^@/, "").trim();
  return (
    c.id === want ||
    c.name.toLowerCase() === want ||
    c.handle?.toLowerCase().replace(/^@/, "") === want ||
    c.channel_id?.toLowerCase() === want
  );
};

/** Add a channel, replacing an earlier login for the same channel. */
export function upsertChannel(channel: StoredChannel): string {
  const store = loadStore();
  store.channels = store.channels.filter(
    (c) => c.id !== channel.id && !(channel.channel_id && c.channel_id === channel.channel_id),
  );
  store.channels.push(channel);
  return saveStore(store);
}

/** Forget a channel. Returns what was removed, or undefined when nothing matched. */
export function removeChannel(hint: string): StoredChannel | undefined {
  const store = loadStore();
  const found = store.channels.find((c) => matches(c, hint));
  if (!found) return undefined;
  store.channels = store.channels.filter((c) => c !== found);
  saveStore(store);
  return found;
}

/** Save or clear the API key used for public search and research. */
export function setApiKey(key: string | undefined): string {
  const store = loadStore();
  store.api_key = key || undefined;
  return saveStore(store);
}
