import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkUpdate, CHECK_INTERVAL_MS, getStatus } from "../src/commands.mjs";
import { saveAuth, saveUpdateState } from "../src/local-state.mjs";
import { installArchive, sha256 } from "../src/installer.mjs";
import { packageZip } from "./helpers/zip.mjs";

test("automatic update checks use a 24 hour cache", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "howto-cache-"));
  const env = { HOWTO_HOME: home };
  const now = Date.parse("2026-10-04T00:00:00Z");
  await saveUpdateState({ "howto-swt-pro": { installed_version: "1.0.0", last_checked: new Date(now - 1000).toISOString(), latest_seen: "1.0.0" } }, env);
  let requests = 0;
  const result = await checkUpdate("howto-swt-pro", { env, auto: true, now: () => now, fetchImpl: async () => { requests += 1; throw new Error("must not request"); }, baseUrl: "https://example.invalid" });
  assert.equal(result.status, "CHECK_SKIPPED_CACHED");
  assert.equal(requests, 0);
});

test("automatic checks fail open when the server is unavailable", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "howto-fail-open-"));
  const env = { HOWTO_HOME: home };
  const now = Date.parse("2026-10-04T00:00:00Z");
  await saveAuth({ product: "howto-swt-pro", email: "member@example.com", session_token: "x".repeat(43), issued_at: new Date(now).toISOString() }, env);
  await saveUpdateState({ "howto-swt-pro": { installed_version: "1.0.0", last_checked: new Date(now - CHECK_INTERVAL_MS - 1).toISOString(), latest_seen: "1.0.0" } }, env);
  const result = await checkUpdate("howto-swt-pro", { env, auto: true, now: () => now, fetchImpl: async () => { throw new Error("offline"); }, baseUrl: "https://example.invalid" });
  assert.equal(result.status, "CHECK_SKIPPED_UNAVAILABLE");
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("manual check reports same version and newer version", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "howto-version-check-"));
  const env = { HOWTO_HOME: home };
  await saveAuth({ product: "howto-swt-pro", email: "member@example.com", session_token: "x".repeat(43), issued_at: "2026-10-04T00:00:00Z" }, env);
  await saveUpdateState({ "howto-swt-pro": { installed_version: "1.0.0", last_checked: null, latest_seen: "1.0.0" } }, env);
  let latestVersion = "1.0.0";
  const fetchImpl = async (url) => {
    if (url.endsWith("/v1/entitlement")) return jsonResponse({ product: "howto-swt-pro", status: "active", updates_allowed: true });
    if (url.endsWith("/latest")) return jsonResponse({ product: "howto-swt-pro", version: latestVersion, summary: `Release ${latestVersion}`, sha256: "a".repeat(64), size: 1 });
    return jsonResponse({ code: "NOT_FOUND" }, 404);
  };
  const same = await checkUpdate("howto-swt-pro", { env, baseUrl: "https://mock.local", fetchImpl, now: () => Date.parse("2026-10-04T00:00:00Z") });
  assert.equal(same.status, "UP_TO_DATE");
  latestVersion = "1.0.1";
  const newer = await checkUpdate("howto-swt-pro", { env, baseUrl: "https://mock.local", fetchImpl, now: () => Date.parse("2026-10-05T00:00:00Z") });
  assert.deepEqual(newer, {
    status: "UPDATE_AVAILABLE", product: "howto-swt-pro", current_version: "1.0.0", latest_version: "1.0.1", summary: "Release 1.0.1",
  });
});

test("status verifies installation, entitlement, and cloud version", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "howto-status-"));
  const installRoot = path.join(home, "skills");
  const env = { HOWTO_HOME: home };
  const archive = packageZip("1.0.0");
  await installArchive({
    archive,
    expectedSha256: sha256(archive),
    product: "howto-swt-pro",
    version: "1.0.0",
    destination: path.join(installRoot, "howto-swt-pro"),
  });
  await saveAuth({
    product: "howto-swt-pro",
    email: "member@example.com",
    session_token: "x".repeat(43),
    issued_at: "2026-10-04T00:00:00Z",
  }, env);
  await saveUpdateState({
    "howto-swt-pro": { installed_version: "1.0.0", last_checked: null, latest_seen: "1.0.0" },
  }, env);
  const fetchImpl = async (url) => {
    if (url.endsWith("/v1/entitlement")) return jsonResponse({ product: "howto-swt-pro", status: "active", updates_allowed: true });
    if (url.endsWith("/latest")) return jsonResponse({ product: "howto-swt-pro", version: "1.0.1", summary: "Update", sha256: "a".repeat(64), size: 1 });
    return jsonResponse({ code: "NOT_FOUND" }, 404);
  };
  const result = await getStatus({ env, agent: "generic", installRoot, baseUrl: "https://mock.local", fetchImpl });
  assert.equal(result.installation.verified, true);
  assert.equal(result.entitlement.status, "active");
  assert.equal(result.latest_version, "1.0.1");
  assert.equal(result.update, "available");
});
