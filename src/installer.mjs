import crypto from "node:crypto";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { extractZipSecure } from "./archive.mjs";
import { HowToError } from "./errors.mjs";

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

export async function installArchive({ archive, expectedSha256, product, version, destination, verify = verifyInstalledPackage }) {
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
