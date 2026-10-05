import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractZipSecure } from "../src/archive.mjs";
import { installArchive, sha256 } from "../src/installer.mjs";
import { makeZip, packageZip } from "./helpers/zip.mjs";

test("install verifies SHA-256 and installs the package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "howto-install-"));
  const archive = packageZip("1.0.0");
  const destination = path.join(root, "skills", "howto-swt-pro");
  const result = await installArchive({ archive, expectedSha256: sha256(archive), product: "howto-swt-pro", version: "1.0.0", destination });
  assert.equal(result.replaced, false);
  assert.match(await readFile(path.join(destination, "skills/swt/SKILL.md"), "utf8"), /1\.0\.0/);
});

test("SHA mismatch rejects before install", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "howto-sha-"));
  await assert.rejects(
    installArchive({ archive: packageZip("1.0.0"), expectedSha256: "0".repeat(64), product: "howto-swt-pro", version: "1.0.0", destination: path.join(root, "target") }),
    { code: "SHA256_MISMATCH" },
  );
});

test("unsafe ZIP traversal and symlinks are rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "howto-unsafe-"));
  await assert.rejects(extractZipSecure(makeZip([{ name: "../escape", data: "bad" }]), path.join(root, "a")), { code: "UNSAFE_ZIP" });
  await assert.rejects(extractZipSecure(makeZip([{ name: "link", data: "target", mode: 0o120777 }]), path.join(root, "b")), { code: "UNSAFE_ZIP" });
});

test("failed post-replace verification rolls back old version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "howto-rollback-"));
  const destination = path.join(root, "howto-swt-pro");
  await mkdir(path.join(destination, "skills/swt"), { recursive: true });
  await writeFile(path.join(destination, "plugin.json"), JSON.stringify({ name: "howto-swt-pro", version: "0.9.0" }));
  await writeFile(path.join(destination, "skills/swt/SKILL.md"), "old-version");
  let calls = 0;
  const archive = packageZip("1.0.0");
  await assert.rejects(
    installArchive({
      archive,
      expectedSha256: sha256(archive),
      product: "howto-swt-pro",
      version: "1.0.0",
      destination,
      verify: async () => { calls += 1; if (calls === 2) throw new Error("simulated disk verification failure"); },
    }),
    { code: "INSTALL_ROLLED_BACK" },
  );
  assert.equal(await readFile(path.join(destination, "skills/swt/SKILL.md"), "utf8"), "old-version");
});

test("update does not touch external USER_DATA_ROOT", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "howto-data-boundary-"));
  const userData = path.join(root, "user-data");
  await mkdir(userData);
  const sentinel = path.join(userData, "swt-user-state.json");
  await writeFile(sentinel, JSON.stringify({ offers: ["keep-me"] }));
  const archive = packageZip("1.0.0");
  await installArchive({ archive, expectedSha256: sha256(archive), product: "howto-swt-pro", version: "1.0.0", destination: path.join(root, "skills/howto-swt-pro") });
  assert.deepEqual(JSON.parse(await readFile(sentinel, "utf8")), { offers: ["keep-me"] });
  assert.ok((await stat(userData)).isDirectory());
});
