import crypto from "node:crypto";
import { rm } from "node:fs/promises";
import { resolveAdapter } from "./adapters/index.mjs";
import { HowToError } from "./errors.mjs";
import { installRuntimeArchive, sha256 as archiveSha256 } from "./installer.mjs";
import { editionPreflight } from "./runtime.mjs";
import {
  loadOfflineDeviceKey,
  loadOfflineRequest,
  loadOrCreateDevice,
  loadOrCreateOfflineDeviceKey,
  loadUpdateState,
  saveOfflineRequest,
  saveUpdateState,
  statePaths,
} from "./local-state.mjs";
import {
  decodeJson,
  decryptBundle,
  encodeJson,
  publicKeyFingerprint,
  REQUEST_PREFIX,
  sha256Hex,
  unwrapReleaseKey,
  verifyActivationToken,
} from "./offline-crypto.mjs";

export const DEFAULT_OFFLINE_MANIFEST_URL = "https://raw.githubusercontent.com/0x-howard/howto-swt-pro-dist/main/manifest.json";
export const DEFAULT_ACTIVATION_URL = "https://howto-swt-api-staging.howto-cloud.workers.dev/activate";

function manifestUrl(options) {
  return options.manifestUrl || options.env?.HOWTO_OFFLINE_MANIFEST_URL || process.env.HOWTO_OFFLINE_MANIFEST_URL || DEFAULT_OFFLINE_MANIFEST_URL;
}

async function fetchWithTimeout(url, fetchImpl, timeoutMs = 10_000) {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new HowToError("OFFLINE_DISTRIBUTION_UNAVAILABLE", "无法从 GitHub 获取 Offline 分发文件。", { cause: error });
  }
}

export async function fetchOfflineManifest(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await fetchWithTimeout(manifestUrl(options), fetchImpl, options.timeoutMs);
  if (!response.ok) throw new HowToError("OFFLINE_MANIFEST_UNAVAILABLE", `Offline manifest 返回 ${response.status}。`);
  const manifest = await response.json();
  if (manifest?.product !== "howto-swt-pro" || !manifest.latest || !manifest.releases?.[manifest.latest]) {
    throw new HowToError("INVALID_OFFLINE_MANIFEST", "Offline manifest 格式无效。");
  }
  return manifest;
}

export async function createOfflineActivationRequest(product, options = {}) {
  if (product !== "howto-swt-pro") throw new HowToError("UNSUPPORTED_PRODUCT", `不支持的产品：${product}`);
  const env = options.env || process.env;
  const [manifest, device, deviceKey] = await Promise.all([
    fetchOfflineManifest(options),
    loadOrCreateDevice({ agent: options.agent || "doubao-work", env }),
    loadOrCreateOfflineDeviceKey(env),
  ]);
  const version = options.requestedVersion || manifest.latest;
  if (!manifest.releases[version]) throw new HowToError("RELEASE_NOT_FOUND", `Offline 版本不存在：${version}`);
  const payload = {
    request_version: 1,
    product,
    device_id: device.device_id,
    device_public_key: deviceKey.public_key_spki,
    requested_version: version,
    nonce: crypto.randomBytes(24).toString("base64url"),
    timestamp: new Date(options.now?.() || Date.now()).toISOString(),
  };
  const activationRequest = encodeJson(REQUEST_PREFIX, payload);
  await saveOfflineRequest({ ...payload, activation_request: activationRequest }, env);
  const activationBase = options.activationUrl || env.HOWTO_ACTIVATION_URL || DEFAULT_ACTIVATION_URL;
  return {
    status: "OFFLINE_ACTIVATION_REQUIRED",
    product,
    version,
    activation_url: `${activationBase}?request=${encodeURIComponent(activationRequest)}`,
    activation_request: activationRequest,
  };
}

function validateTokenPayload(payload, pending, device, deviceKey, product) {
  if (payload.token_version !== 1 || payload.product !== product) throw new HowToError("ACTIVATION_TOKEN_MISMATCH", "Activation Token 产品不匹配。");
  if (payload.version !== pending?.requested_version || payload.request_nonce !== pending?.nonce) {
    throw new HowToError("ACTIVATION_TOKEN_MISMATCH", "Activation Token 与当前 activation request 不匹配。");
  }
  if (payload.device_id !== device.device_id || payload.device_public_key_fingerprint !== publicKeyFingerprint(deviceKey.public_key_spki)) {
    throw new HowToError("WRONG_DEVICE", "Activation Token 不属于当前设备。");
  }
  if (new Date(payload.entitlement_expires_at).getTime() < Date.now()) {
    throw new HowToError("ACTIVATION_EXPIRED", "会员资格已过期，不能激活该版本。");
  }
}

export async function installOfflineProduct(product, options = {}) {
  const env = options.env || process.env;
  const adapter = resolveAdapter({ agent: options.agent, installRoot: options.installRoot, config: options.config, env });
  const preflight = await editionPreflight(adapter, "pro", { replaceConfirmed: options.replaceConfirmed });
  if (["EDITION_REPLACE_CONFIRMATION_REQUIRED", "EDITION_CONFLICT"].includes(preflight.status)) return preflight;
  if (!options.activationToken) return createOfflineActivationRequest(product, options);
  const pending = await loadOfflineRequest(env);
  if (!pending) throw new HowToError("OFFLINE_REQUEST_REQUIRED", "请先生成 Offline Activation Request。");
  const device = await loadOrCreateDevice({ agent: options.agent || "doubao-work", env });
  const deviceKey = await loadOfflineDeviceKey(env);
  if (!deviceKey) throw new HowToError("OFFLINE_DEVICE_KEY_MISSING", "本机 Offline device key 不存在。");
  const payload = verifyActivationToken(options.activationToken, options.signingPublicKey);
  validateTokenPayload(payload, pending, device, deviceKey, product);

  const manifest = await fetchOfflineManifest(options);
  const release = manifest.releases?.[payload.version];
  if (!release || release.ciphertext_sha256 !== payload.ciphertext_sha256 || release.asset_url !== payload.asset_url) {
    throw new HowToError("ACTIVATION_RELEASE_MISMATCH", "Activation Token 与公开 manifest 不匹配。");
  }
  const response = await fetchWithTimeout(release.asset_url, options.fetchImpl || globalThis.fetch, options.timeoutMs);
  if (!response.ok) throw new HowToError("OFFLINE_BUNDLE_UNAVAILABLE", `Encrypted bundle 返回 ${response.status}。`);
  const encrypted = Buffer.from(await response.arrayBuffer());
  if (sha256Hex(encrypted) !== release.ciphertext_sha256) throw new HowToError("BUNDLE_SHA256_MISMATCH", "Encrypted bundle SHA-256 校验失败。");

  let releaseKey;
  let archive;
  try {
    releaseKey = unwrapReleaseKey(payload, deviceKey.private_key_pkcs8);
    archive = decryptBundle(encrypted, releaseKey, product, payload.version);
    const installed = await installRuntimeArchive({
      archive,
      expectedSha256: archiveSha256(archive),
      product,
      version: payload.version,
      adapter,
      replaceConfirmed: options.replaceConfirmed,
      installedAt: options.installedAt,
      verify: options.verify,
      verifyFlat: options.verifyFlat,
    });
    if (installed.status === "EDITION_REPLACE_CONFIRMATION_REQUIRED") return installed;
    const state = await loadUpdateState(env);
    state[product] = {
      installed_version: payload.version,
      latest_seen: manifest.latest,
      last_checked: new Date(options.now?.() || Date.now()).toISOString(),
      activation: "offline",
    };
    await saveUpdateState(state, env);
    await rm(statePaths(env).offlineRequest, { force: true });
    return { status: "INSTALLED", product, agent: adapter.name, activation: "offline", ...installed };
  } finally {
    releaseKey?.fill(0);
    archive?.fill(0);
    encrypted.fill(0);
  }
}

export async function checkOfflineUpdate(product, options = {}) {
  if (product !== "howto-swt-pro") throw new HowToError("UNSUPPORTED_PRODUCT", `不支持的产品：${product}`);
  const manifest = await fetchOfflineManifest(options);
  const state = await loadUpdateState(options.env || process.env);
  const current = state[product]?.installed_version || null;
  if (current && current !== manifest.latest) {
    return { status: "UPDATE_AVAILABLE", product, current_version: current, latest_version: manifest.latest, summary: manifest.releases[manifest.latest].summary, activation_required: true };
  }
  return { status: "UP_TO_DATE", product, current_version: current, latest_version: manifest.latest };
}

export function decodeActivationRequest(value) {
  return decodeJson(value, REQUEST_PREFIX);
}
