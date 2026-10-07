import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { genericAdapter } from "../src/adapters/generic.mjs";
import { workbuddyAdapter } from "../src/adapters/workbuddy.mjs";
import { installProduct } from "../src/commands.mjs";
import { installRuntimeArchive, sha256 } from "../src/installer.mjs";
import { detectRuntime, RUNTIME_FILENAME, RUNTIME_SKILLS, RUNTIME_STATUSES } from "../src/runtime.mjs";
import { packageZip } from "./helpers/zip.mjs";


async function tempRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function manifestResponse(manifest, archive) {
  return async (url) => url === manifest.asset_url
    ? new Response(archive, { status: 200 })
    : new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
}

test("empty package runtime installs Free with canonical identity", async () => {
  const root = await tempRoot("howto-runtime-free-");
  const adapter = genericAdapter({ installRoot: root });
  const archive = packageZip("1.2.0", "howto-swt");
  const result = await installRuntimeArchive({ archive, expectedSha256: sha256(archive), product: "howto-swt", version: "1.2.0", adapter, installedAt: "2026-10-07T00:00:00Z" });
  assert.equal(result.runtime_identity.edition, "free");
  assert.equal((await detectRuntime(adapter)).identity.version, "1.2.0");
});

test("Runtime Status Contract contains all cross-edition and update states", () => {
  assert.deepEqual(new Set(RUNTIME_STATUSES), new Set([
    "EDITION_CONFLICT", "EDITION_REPLACE_CONFIRMATION_REQUIRED", "UPDATE_AVAILABLE", "UP_TO_DATE",
    "CHECK_SKIPPED_CACHED", "CHECK_SKIPPED_UNAVAILABLE", "ENTITLEMENT_EXPIRED", "INSTALL_ROLLED_BACK",
  ]));
});

test("same Free and same Pro editions upgrade without replacement confirmation", async () => {
  for (const product of ["howto-swt", "howto-swt-pro"]) {
    const root = await tempRoot("howto-runtime-same-");
    const adapter = genericAdapter({ installRoot: root });
    for (const version of ["1.0.0", "1.1.0"]) {
      const archive = packageZip(version, product);
      const result = await installRuntimeArchive({ archive, expectedSha256: sha256(archive), product, version, adapter });
      assert.equal(result.version, version);
    }
  }
});

test("Pro to Free requires explicit confirmation and refusal leaves runtime unchanged", async () => {
  const root = await tempRoot("howto-pro-free-");
  const adapter = genericAdapter({ installRoot: root });
  const pro = packageZip("1.1.0", "howto-swt-pro");
  await installRuntimeArchive({ archive: pro, expectedSha256: sha256(pro), product: "howto-swt-pro", version: "1.1.0", adapter });
  const free = packageZip("1.2.0", "howto-swt");
  const guarded = await installRuntimeArchive({ archive: free, expectedSha256: sha256(free), product: "howto-swt", version: "1.2.0", adapter });
  assert.deepEqual({ status: guarded.status, installed_edition: guarded.installed_edition, target_edition: guarded.target_edition },
    { status: "EDITION_REPLACE_CONFIRMATION_REQUIRED", installed_edition: "pro", target_edition: "free" });
  assert.equal((await detectRuntime(adapter)).identity.edition, "pro");
  const switched = await installRuntimeArchive({ archive: free, expectedSha256: sha256(free), product: "howto-swt", version: "1.2.0", adapter, replaceConfirmed: true });
  assert.equal(switched.runtime_identity.edition, "free");
});

test("Free to Pro requires explicit confirmation", async () => {
  const root = await tempRoot("howto-free-pro-");
  const adapter = genericAdapter({ installRoot: root });
  const free = packageZip("1.2.0", "howto-swt");
  await installRuntimeArchive({ archive: free, expectedSha256: sha256(free), product: "howto-swt", version: "1.2.0", adapter });
  const pro = packageZip("1.1.0", "howto-swt-pro");
  const guarded = await installRuntimeArchive({ archive: pro, expectedSha256: sha256(pro), product: "howto-swt-pro", version: "1.1.0", adapter });
  assert.equal(guarded.status, "EDITION_REPLACE_CONFIRMATION_REQUIRED");
  assert.equal(guarded.installed_edition, "free");
});

test("WorkBuddy defaults to ~/.workbuddy/skills and installs flat six skills", async () => {
  const home = await tempRoot("howto-workbuddy-home-");
  const adapter = workbuddyAdapter({ env: { HOME: home } });
  assert.equal(adapter.root, path.join(home, ".workbuddy", "skills"));
  const archive = packageZip("1.2.0", "howto-swt");
  await installRuntimeArchive({ archive, expectedSha256: sha256(archive), product: "howto-swt", version: "1.2.0", adapter });
  for (const skill of RUNTIME_SKILLS) await access(path.join(adapter.root, skill, "SKILL.md"));
  const names = await readdir(adapter.root);
  assert.equal(names.filter((name) => RUNTIME_SKILLS.includes(name)).length, 6);
  assert.ok(names.includes(RUNTIME_FILENAME));
  assert.equal(names.includes("howto-swt"), false);
  assert.equal(names.includes("howto-swt-pro"), false);
});

test("empty WorkBuddy runtime installs Pro with the same flat-six contract", async () => {
  const root = await tempRoot("howto-workbuddy-pro-");
  const adapter = workbuddyAdapter({ installRoot: root });
  const archive = packageZip("1.1.0", "howto-swt-pro");
  const result = await installRuntimeArchive({ archive, expectedSha256: sha256(archive),
    product: "howto-swt-pro", version: "1.1.0", adapter });
  assert.equal(result.runtime_identity.edition, "pro");
  assert.equal((await detectRuntime(adapter)).identity.version, "1.1.0");
  for (const skill of RUNTIME_SKILLS) await access(path.join(root, skill, "SKILL.md"));
});

test("WorkBuddy edition switch is guarded and leaves no mixed files", async () => {
  const root = await tempRoot("howto-workbuddy-switch-");
  const adapter = workbuddyAdapter({ installRoot: root });
  const free = packageZip("1.2.0", "howto-swt");
  await installRuntimeArchive({ archive: free, expectedSha256: sha256(free), product: "howto-swt", version: "1.2.0", adapter });
  const pro = packageZip("1.1.0", "howto-swt-pro");
  const guarded = await installRuntimeArchive({ archive: pro, expectedSha256: sha256(pro), product: "howto-swt-pro", version: "1.1.0", adapter });
  assert.equal(guarded.status, "EDITION_REPLACE_CONFIRMATION_REQUIRED");
  await installRuntimeArchive({ archive: pro, expectedSha256: sha256(pro), product: "howto-swt-pro", version: "1.1.0", adapter, replaceConfirmed: true });
  const identity = (await detectRuntime(adapter)).identity;
  assert.equal(identity.edition, "pro");
  for (const skill of RUNTIME_SKILLS) assert.match(await readFile(path.join(root, skill, "SKILL.md"), "utf8"), /1\.1\.0/);
  assert.equal((await readdir(root)).some((name) => name.includes(".stage-") || name.includes(".backup-") || name.includes(".extract-")), false);
});

test("failed WorkBuddy verification rolls back all six skills and identity", async () => {
  const root = await tempRoot("howto-workbuddy-rollback-");
  const adapter = workbuddyAdapter({ installRoot: root });
  const oldArchive = packageZip("1.0.0", "howto-swt");
  await installRuntimeArchive({ archive: oldArchive, expectedSha256: sha256(oldArchive), product: "howto-swt", version: "1.0.0", adapter });
  const nextArchive = packageZip("1.2.0", "howto-swt");
  let calls = 0;
  await assert.rejects(installRuntimeArchive({
    archive: nextArchive, expectedSha256: sha256(nextArchive), product: "howto-swt", version: "1.2.0", adapter,
    verifyFlat: async () => { calls += 1; if (calls === 2) throw new Error("simulated final verification failure"); },
  }), { code: "INSTALL_ROLLED_BACK" });
  assert.equal((await detectRuntime(adapter)).identity.version, "1.0.0");
  for (const skill of RUNTIME_SKILLS) assert.match(await readFile(path.join(root, skill, "SKILL.md"), "utf8"), /1\.0\.0/);
});

test("Free public manifest install uses SHA-256 and Runtime guard", async () => {
  const root = await tempRoot("howto-free-command-");
  const archive = packageZip("1.2.0", "howto-swt");
  const manifest = { schema_version: 1, product: "howto-swt", version: "1.2.0", summary: "Release",
    sha256: sha256(archive), asset_url: "https://example.invalid/howto-swt-1.2.0.zip" };
  const result = await installProduct("howto-swt", { env: { HOWTO_HOME: path.join(root, ".howto") }, agent: "generic",
    installRoot: path.join(root, "skills"), fetchImpl: manifestResponse(manifest, archive) });
  assert.equal(result.status, "INSTALLED");
  assert.equal(result.runtime_identity.edition, "free");
});

test("legacy Pro package migrates to canonical Runtime without residue", async () => {
  const root = await tempRoot("howto-legacy-pro-");
  const adapter = genericAdapter({ installRoot: root });
  const legacy = path.join(root, "howto-swt-pro");
  await mkdir(path.join(legacy, "skills", "swt"), { recursive: true });
  await writeFile(path.join(legacy, "plugin.json"), JSON.stringify({ name: "howto-swt-pro", version: "1.0.1" }));
  await writeFile(path.join(legacy, "skills", "swt", "SKILL.md"), "legacy");
  const next = packageZip("1.1.0", "howto-swt-pro");
  const result = await installRuntimeArchive({ archive: next, expectedSha256: sha256(next), product: "howto-swt-pro", version: "1.1.0", adapter });
  assert.equal(result.migrated_legacy, true);
  await assert.rejects(access(legacy), { code: "ENOENT" });
  assert.equal((await detectRuntime(adapter)).identity.edition, "pro");
});

test("multiple legacy Editions report machine-readable EDITION_CONFLICT", async () => {
  const root = await tempRoot("howto-edition-conflict-");
  const adapter = genericAdapter({ installRoot: root });
  for (const [name, version] of [["howto-swt", "1.1.1"], ["howto-swt-pro", "1.0.1"]]) {
    const directory = path.join(root, name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "plugin.json"), JSON.stringify({ name, version }));
  }
  const archive = packageZip("1.2.0", "howto-swt");
  const result = await installRuntimeArchive({ archive, expectedSha256: sha256(archive), product: "howto-swt", version: "1.2.0", adapter });
  assert.equal(result.status, "EDITION_CONFLICT");
});
