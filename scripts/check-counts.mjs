#!/usr/bin/env node
/**
 * The tool count appears in the README, SKILL.md, package.json, SECURITY.md and
 * the repo description. Five places to update by hand is five places to forget,
 * and a README that claims a number the server does not serve is the kind of
 * error a reader finds before you do.
 *
 * So the server is the source of truth. This starts it, asks what it actually
 * exposes, and fails if any document disagrees.
 *
 * Run it with `npm run check:counts`. CI runs it on every push.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "dist", "index.js");

if (!existsSync(server)) {
  console.error("dist/index.js is missing. Run `npm run build` first.");
  process.exit(1);
}

/** Ask a freshly started server for its tool list. */
function toolsFrom(env) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [server], {
      env: {
        ...process.env,
        YOUTUBE_API_KEY: "placeholder",
        YOUTUBE_MCP_HOME: join(root, "node_modules", ".cache", "count-check"),
        ...env,
      },
      stdio: ["pipe", "pipe", "ignore"],
    });

    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the server did not answer tools/list within 20s"));
    }, 20_000);

    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) {
            clearTimeout(timer);
            child.kill();
            resolve(msg.result.tools);
            return;
          }
        } catch {
          // A partial line. Wait for the rest.
        }
      }
    });
    child.on("error", reject);

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "count-check", version: "1" },
        },
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n",
    );
  });
}

const all = await toolsFrom({});
const total = all.length;
const read = all.filter((t) => t.annotations?.readOnlyHint === true).length;
const write = total - read;

// Read-only mode must expose exactly the read tools and nothing else.
const readOnly = await toolsFrom({ YOUTUBE_READ_ONLY: "1" });

const problems = [];

// The version is the other number that silently drifts. `--version` exists to
// answer "which build is this", so it lying is worse than it being absent.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const reported = await new Promise((resolve) => {
  const child = spawn("node", [server, "--version"], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.on("close", () => resolve(out.trim()));
});
if (reported !== pkg.version) {
  problems.push(`--version reports ${reported} but package.json says ${pkg.version}`);
}

if (readOnly.length !== read) {
  problems.push(
    `read-only mode exposes ${readOnly.length} tools but there are ${read} read tools`,
  );
}
const leaked = readOnly.filter((t) => t.annotations?.readOnlyHint !== true);
if (leaked.length) {
  problems.push(`read-only mode exposes writes: ${leaked.map((t) => t.name).join(", ")}`);
}
const unannotated = all.filter((t) => t.annotations?.readOnlyHint === undefined);
if (unannotated.length) {
  problems.push(`missing annotations: ${unannotated.map((t) => t.name).join(", ")}`);
}

/**
 * Check the documents. Historical entries in CHANGELOG.md are deliberately not
 * checked: "26 tools" in the 1.0.0 notes is a fact about 1.0.0.
 */
const checks = [
  ["README.md", /(\d+) tools/g, total],
  ["README.md", /(\d+) read tools/g, read],
  ["README.md", /(\d+) write tools/g, write],
  ["SKILL.md", /(\d+) tools/g, total],
  ["SECURITY.md", /(\d+) read tools/g, read],
  ["package.json", /(\d+) tools/g, total],
];

for (const [file, pattern, expected] of checks) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const m of text.matchAll(pattern)) {
    if (Number(m[1]) !== expected) {
      problems.push(`${file} says "${m[0]}" but the server has ${expected}`);
    }
  }
}

if (problems.length) {
  console.error(`Tool counts disagree with the server (${total} tools, ${read} read, ${write} write):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nUpdate the documents, or the tools, so they match.");
  process.exit(1);
}

console.log(`v${pkg.version}: ${total} tools, ${read} read, ${write} write. Every document agrees.`);
