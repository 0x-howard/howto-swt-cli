import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { HowToError } from "./errors.mjs";

export const RUNTIME_FILENAME = ".howto-runtime.json";
export const RUNTIME_PRODUCT = "howto-swt";
export const RUNTIME_STATUSES = Object.freeze([
  "EDITION_CONFLICT", "EDITION_REPLACE_CONFIRMATION_REQUIRED", "UPDATE_AVAILABLE", "UP_TO_DATE",
  "CHECK_SKIPPED_CACHED", "CHECK_SKIPPED_UNAVAILABLE", "ENTITLEMENT_EXPIRED", "INSTALL_ROLLED_BACK",
]);
export const RUNTIME_SKILLS = Object.freeze([
  "swt", "swt-application", "swt-position", "swt-english", "swt-visa", "swt-arrival",
]);

export function editionForProduct(product) {
  if (product === "howto-swt") return "free";
  if (product === "howto-swt-pro") return "pro";
  throw new HowToError("UNSUPPORTED_PRODUCT", `不支持的产品：${product}`);
}

export function runtimeDestination(adapter) {
  return adapter.layout === "flat-six" ? adapter.root : adapter.destination(RUNTIME_PRODUCT);
}

export function runtimeIdentityPath(adapter) {
  return adapter.layout === "flat-six"
    ? path.join(adapter.root, RUNTIME_FILENAME)
    : path.join(runtimeDestination(adapter), RUNTIME_FILENAME);
}

export function makeRuntimeIdentity({ edition, version, installedAt = new Date().toISOString() }) {
  return {
    schema_version: 1,
    product: RUNTIME_PRODUCT,
    edition,
    version,
    managed_by: "howto-swt-cli",
    installed_at: installedAt,
  };
}

export function validateRuntimeIdentity(value) {
  const keys = ["schema_version", "product", "edition", "version", "managed_by", "installed_at"];
  if (!value || typeof value !== "object" || keys.some((key) => !(key in value))) {
    throw new HowToError("RUNTIME_IDENTITY_INVALID", "HowTo SWT Runtime Identity 缺失必要字段。");
  }
  if (value.schema_version !== 1 || value.product !== RUNTIME_PRODUCT || !["free", "pro"].includes(value.edition)) {
    throw new HowToError("RUNTIME_IDENTITY_INVALID", "HowTo SWT Runtime Identity 产品或 Edition 无效。");
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version) || value.managed_by !== "howto-swt-cli") {
    throw new HowToError("RUNTIME_IDENTITY_INVALID", "HowTo SWT Runtime Identity 版本或管理器无效。");
  }
  return value;
}

export async function detectRuntime(adapter) {
  const markerCandidates = adapter.layout === "flat-six"
    ? [runtimeIdentityPath(adapter)]
    : [adapter.destination("howto-swt"), adapter.destination("howto-swt-pro")].map((root) => path.join(root, RUNTIME_FILENAME));
  const identities = [];
  for (const identityFile of markerCandidates) {
    try {
      identities.push({ identity: validateRuntimeIdentity(JSON.parse(await readFile(identityFile, "utf8"))), identity_file: identityFile });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (identities.length > 1) return { status: "EDITION_CONFLICT", identities, identity: null, layout: adapter.layout || "package" };
  if (identities.length === 1) return { status: "RUNTIME_DETECTED", ...identities[0], layout: adapter.layout || "package" };

  const legacyCandidates = adapter.layout === "flat-six" ? RUNTIME_SKILLS.map((skill) => path.join(adapter.root, skill))
    : [adapter.destination("howto-swt"), adapter.destination("howto-swt-pro")];
  if (adapter.layout !== "flat-six") {
    const legacy = [];
    for (const candidate of legacyCandidates) {
      try {
        const manifest = JSON.parse(await readFile(path.join(candidate, "plugin.json"), "utf8"));
        const edition = manifest.name === "howto-swt" ? "free" : manifest.name === "howto-swt-pro" ? "pro" : null;
        if (edition && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version || "")) {
          legacy.push({ candidate, identity: { schema_version: 1, product: RUNTIME_PRODUCT, edition, version: manifest.version,
            managed_by: "legacy-package-manifest", installed_at: null } });
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (legacy.length > 1) return { status: "EDITION_CONFLICT", identities: legacy, identity: null, layout: "package" };
    if (legacy.length === 1) return { status: "LEGACY_RUNTIME_DETECTED", identity: legacy[0].identity,
      legacy_path: legacy[0].candidate, layout: "package" };
  }
  for (const candidate of legacyCandidates) {
    try {
      await access(candidate);
      return { status: "RUNTIME_IDENTITY_REQUIRED", identity: null, layout: adapter.layout || "package" };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { status: "NOT_INSTALLED", identity: null, layout: adapter.layout || "package" };
}

export async function editionPreflight(adapter, targetEdition, { replaceConfirmed = false } = {}) {
  const detected = await detectRuntime(adapter);
  if (detected.status === "EDITION_CONFLICT") {
    return { status: "EDITION_CONFLICT", product: RUNTIME_PRODUCT };
  }
  if (detected.status === "RUNTIME_IDENTITY_REQUIRED") {
    throw new HowToError("RUNTIME_IDENTITY_REQUIRED", "检测到旧版 HowTo SWT 文件但没有 Runtime Identity；请先执行受控修复，CLI 不会猜测 Edition。");
  }
  if (!detected.identity || detected.identity.edition === targetEdition) return { status: "EDITION_OK", detected };
  if (!replaceConfirmed) {
    return {
      status: "EDITION_REPLACE_CONFIRMATION_REQUIRED",
      product: RUNTIME_PRODUCT,
      installed_edition: detected.identity.edition,
      installed_version: detected.identity.version,
      target_edition: targetEdition,
    };
  }
  return { status: "EDITION_SWITCH_CONFIRMED", detected };
}
