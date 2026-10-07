import crypto from "node:crypto";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractZipSecure } from "./archive.mjs";
import { HowToError } from "./errors.mjs";
import {
  RUNTIME_FILENAME,
  RUNTIME_SKILLS,
  editionForProduct,
  editionPreflight,
  makeRuntimeIdentity,
  runtimeDestination,
  validateRuntimeIdentity,
} from "./runtime.mjs";

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function verifyInstalledPackage(directory, { product, version }) {
  const manifestPath = path.join(directory, "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.name !== product || manifest.version !== version) {
    throw new HowToError("INSTALL_VERIFY_FAILED", "安装包的产品或版本元数据不匹配。");
  }
  await access(path.join(directory, "skills", "swt", "SKILL.md"));
  return manifest;
}

export async function installArchive({ archive, expectedSha256, product, version, destination, verify = verifyInstalledPackage, prepare }) {
  const actual = sha256(archive);
  if (!expectedSha256 || actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new HowToError("SHA256_MISMATCH", "下载包 SHA-256 校验失败，未执行安装。", {
      details: { expected: expectedSha256, actual },
    });
  }
  const target = path.resolve(destination);
  const parent = path.dirname(target);
  const nonce = crypto.randomBytes(6).toString("hex");
  const stage = path.join(parent, `.${path.basename(target)}.stage-${nonce}`);
  const backup = path.join(parent, `.${path.basename(target)}.backup-${nonce}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  let hadPrevious = false;
  try {
    await extractZipSecure(archive, stage);
    if (prepare) await prepare(stage);
    await verify(stage, { product, version });
    try {
      await rename(target, backup);
      hadPrevious = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(stage, target);
      await verify(target, { product, version });
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      if (hadPrevious) await rename(backup, target);
      throw new HowToError("INSTALL_ROLLED_BACK", "新版本验证失败，已恢复旧版本。", { cause: error });
    }
    if (hadPrevious) await rm(backup, { recursive: true, force: true });
    return { destination: target, version, sha256: actual, replaced: hadPrevious };
  } finally {
    await rm(stage, { recursive: true, force: true });
    if (!hadPrevious) await rm(backup, { recursive: true, force: true });
  }
}

async function verifyRuntimePackage(directory, { product, version, identity }) {
  await verifyInstalledPackage(directory, { product, version });
  const installedIdentity = validateRuntimeIdentity(JSON.parse(await readFile(path.join(directory, RUNTIME_FILENAME), "utf8")));
  if (JSON.stringify(installedIdentity) !== JSON.stringify(identity)) {
    throw new HowToError("INSTALL_VERIFY_FAILED", "Runtime Identity 写入后验证不一致。");
  }
}

async function verifyFlatRuntime(root, identity) {
  const installedIdentity = validateRuntimeIdentity(JSON.parse(await readFile(path.join(root, RUNTIME_FILENAME), "utf8")));
  if (JSON.stringify(installedIdentity) !== JSON.stringify(identity)) {
    throw new HowToError("INSTALL_VERIFY_FAILED", "WorkBuddy Runtime Identity 验证失败。");
  }
  for (const skill of RUNTIME_SKILLS) await access(path.join(root, skill, "SKILL.md"));
}

async function installFlatRuntime({ archive, expectedSha256, product, version, adapter, identity, verifyFlat = verifyFlatRuntime }) {
  const actual = sha256(archive);
  if (!expectedSha256 || actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new HowToError("SHA256_MISMATCH", "下载包 SHA-256 校验失败，未执行安装。", { details: { expected: expectedSha256, actual } });
  }
  const root = path.resolve(adapter.root);
  const parent = path.dirname(root);
  const nonce = crypto.randomBytes(6).toString("hex");
  const extracted = path.join(parent, `.${path.basename(root)}.extract-${nonce}`);
  const stage = path.join(parent, `.${path.basename(root)}.stage-${nonce}`);
  const backup = path.join(parent, `.${path.basename(root)}.backup-${nonce}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(stage, { recursive: true, mode: 0o700 });
  await mkdir(backup, { recursive: true, mode: 0o700 });
  const movedPrevious = [];
  const placed = [];
  try {
    await extractZipSecure(archive, extracted);
    await verifyInstalledPackage(extracted, { product, version });
    for (const skill of RUNTIME_SKILLS) {
      await access(path.join(extracted, "skills", skill, "SKILL.md"));
      await cp(path.join(extracted, "skills", skill), path.join(stage, skill), { recursive: true, force: false });
    }
    await writeFile(path.join(stage, RUNTIME_FILENAME), `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
    await verifyFlat(stage, identity);

    for (const name of [...RUNTIME_SKILLS, RUNTIME_FILENAME]) {
      try {
        await rename(path.join(root, name), path.join(backup, name));
        movedPrevious.push(name);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    try {
      for (const name of [...RUNTIME_SKILLS, RUNTIME_FILENAME]) {
        await rename(path.join(stage, name), path.join(root, name));
        placed.push(name);
      }
      await verifyFlat(root, identity);
    } catch (error) {
      for (const name of placed) await rm(path.join(root, name), { recursive: true, force: true });
      for (const name of movedPrevious) await rename(path.join(backup, name), path.join(root, name));
      throw new HowToError("INSTALL_ROLLED_BACK", "WorkBuddy 新 Runtime 验证失败，已恢复旧版。", { cause: error });
    }
    return { destination: root, version, sha256: actual, replaced: movedPrevious.length > 0, layout: "flat-six", runtime_identity: identity };
  } finally {
    await rm(extracted, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
  }
}

export async function installRuntimeArchive({ archive, expectedSha256, product, version, adapter,
  replaceConfirmed = false, installedAt, verify, verifyFlat }) {
  const edition = editionForProduct(product);
  const preflight = await editionPreflight(adapter, edition, { replaceConfirmed });
  if (["EDITION_REPLACE_CONFIRMATION_REQUIRED", "EDITION_CONFLICT"].includes(preflight.status)) return preflight;
  const identity = makeRuntimeIdentity({ edition, version, installedAt });
  if (adapter.layout === "flat-six") {
    return installFlatRuntime({ archive, expectedSha256, product, version, adapter, identity, verifyFlat });
  }
  const destination = runtimeDestination(adapter);
  const legacy = preflight.detected?.legacy_path && path.resolve(preflight.detected.legacy_path) !== path.resolve(destination)
    ? path.resolve(preflight.detected.legacy_path) : null;
  const legacyBackup = legacy ? `${legacy}.migration-backup-${crypto.randomBytes(6).toString("hex")}` : null;
  if (legacy) await rename(legacy, legacyBackup);
  try {
    const installed = await installArchive({
      archive, expectedSha256, product, version, destination,
      prepare: async (stage) => writeFile(path.join(stage, RUNTIME_FILENAME), `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 }),
      verify: verify || (async (directory, expected) => verifyRuntimePackage(directory, { ...expected, identity })),
    });
    if (legacyBackup) await rm(legacyBackup, { recursive: true, force: true });
    return { ...installed, layout: "package", runtime_identity: identity, migrated_legacy: Boolean(legacy) };
  } catch (error) {
    if (legacyBackup) await rename(legacyBackup, legacy);
    throw error;
  }
}
