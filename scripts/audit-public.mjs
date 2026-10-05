#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const findings = [];
const forbiddenNames = new Set([".env", ".dev.vars", "auth.json", "update-state.json", "device.json", "offline-device-key.json", "offline-request.json"]);
const patterns = [
  ["Resend API key", /(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/],
  ["session token", /session_token["'\s]*:[\s]*["'][A-Za-z0-9._-]{24,}["']/i],
  ["Bearer token", /Bearer\s+[A-Za-z0-9._-]{24,}/],
  ["OTP pepper value", /OTP_PEPPER\s*[:=]\s*["']?(?!replace|example|test)[A-Za-z0-9._-]{20,}/i],
  ["Cloudflare API token", /CLOUDFLARE_(?:API_)?TOKEN\s*[:=]\s*["']?(?!replace|example|test)[A-Za-z0-9._-]{20,}/i],
  ["offline signing private key", /OFFLINE_SIGNING_PRIVATE_KEY\s*[:=]\s*["'][A-Za-z0-9_-]{40,}/i],
  ["offline release master key", /OFFLINE_RELEASE_MASTER_KEY\s*[:=]\s*["'][A-Za-z0-9_-]{40,}/i],
];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "coverage"].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    const relative = path.relative(root, file);
    if (forbiddenNames.has(entry.name)) findings.push(`${relative}: forbidden local state`);
    if ([".zip", ".pem", ".key", ".p12", ".tgz", ".bundle", ".enc"].includes(path.extname(file).toLowerCase())) findings.push(`${relative}: forbidden private artifact`);
    if (![".js", ".mjs", ".json", ".md", ".txt", ""].includes(path.extname(file).toLowerCase())) continue;
    const text = await readFile(file, "utf8").catch(() => "");
    for (const [label, regex] of patterns) if (regex.test(text)) findings.push(`${relative}: ${label}`);
    for (const match of text.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
      if (!["example.com", "example.org", "example.net", "example.invalid"].includes(match[1].toLowerCase())) findings.push(`${relative}: non-example email address`);
    }
  }
}

await visit(root);
if (findings.length) {
  process.stderr.write(`PUBLIC_AUDIT_FAILED: ${findings.length} risk(s) found.\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("PUBLIC_AUDIT_OK\n");
}
