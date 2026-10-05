import crypto from "node:crypto";
import { HowToError } from "./errors.mjs";

export const BUNDLE_MAGIC = Buffer.from("HTSWTB01", "ascii");
export const TOKEN_PREFIX = "hswact1";
export const REQUEST_PREFIX = "hswreq1";
export const OFFLINE_SIGNING_PUBLIC_KEY_SPKI = "MCowBQYDK2VwAyEAh-N1yDyVRXZBtxKvH2dxiwn8TZDLVhxRJAVhN_DPm_Q";

export function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function fromBase64Url(value, label = "base64url") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HowToError("INVALID_OFFLINE_DATA", `${label} 格式无效。`);
  }
  return Buffer.from(value, "base64url");
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function encodeJson(prefix, value) {
  return `${prefix}.${base64Url(Buffer.from(JSON.stringify(value)))}`;
}

export function decodeJson(encoded, prefix) {
  const parts = String(encoded || "").trim().split(".");
  if (parts.length !== 2 || parts[0] !== prefix) throw new HowToError("INVALID_OFFLINE_DATA", "Offline 数据格式无效。");
  try { return JSON.parse(fromBase64Url(parts[1]).toString("utf8")); }
  catch (error) { throw new HowToError("INVALID_OFFLINE_DATA", "Offline 数据无法解析。", { cause: error }); }
}

export function generateX25519DeviceKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  return {
    algorithm: "X25519",
    private_key_pkcs8: base64Url(privateKey.export({ format: "der", type: "pkcs8" })),
    public_key_spki: base64Url(publicKey.export({ format: "der", type: "spki" })),
  };
}

export function publicKeyFingerprint(publicKeySpki) {
  return sha256Hex(fromBase64Url(publicKeySpki, "device_public_key"));
}

export function verifyActivationToken(token, publicKeySpki = OFFLINE_SIGNING_PUBLIC_KEY_SPKI) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    throw new HowToError("INVALID_ACTIVATION_TOKEN", "Activation Token 格式无效。");
  }
  const payloadBytes = fromBase64Url(parts[1], "activation payload");
  const signature = fromBase64Url(parts[2], "activation signature");
  const publicKey = crypto.createPublicKey({ key: fromBase64Url(publicKeySpki, "server public key"), format: "der", type: "spki" });
  if (!crypto.verify(null, Buffer.from(parts[1]), publicKey, signature)) {
    throw new HowToError("INVALID_ACTIVATION_SIGNATURE", "Activation Token 签名无效。");
  }
  try { return JSON.parse(payloadBytes.toString("utf8")); }
  catch (error) { throw new HowToError("INVALID_ACTIVATION_TOKEN", "Activation Token payload 无法解析。", { cause: error }); }
}

function wrapInfo(payload) {
  return Buffer.from(`howto-swt-offline-wrap-v1\0${payload.product}\0${payload.version}\0${payload.device_id}\0${payload.device_public_key_fingerprint}`);
}

export function unwrapReleaseKey(payload, privateKeyPkcs8) {
  try {
    const privateKey = crypto.createPrivateKey({ key: fromBase64Url(privateKeyPkcs8, "device private key"), format: "der", type: "pkcs8" });
    const publicKey = crypto.createPublicKey({ key: fromBase64Url(payload.ephemeral_public_key, "ephemeral public key"), format: "der", type: "spki" });
    const shared = crypto.diffieHellman({ privateKey, publicKey });
    const info = wrapInfo(payload);
    const kek = Buffer.from(crypto.hkdfSync("sha256", shared, fromBase64Url(payload.hkdf_salt, "HKDF salt"), info, 32));
    const wrapped = fromBase64Url(payload.release_key_wrapped, "wrapped release key");
    if (wrapped.length <= 16) throw new Error("wrapped key too short");
    const decipher = crypto.createDecipheriv("aes-256-gcm", kek, fromBase64Url(payload.wrap_iv, "wrap iv"));
    decipher.setAAD(info);
    decipher.setAuthTag(wrapped.subarray(wrapped.length - 16));
    const key = Buffer.concat([decipher.update(wrapped.subarray(0, -16)), decipher.final()]);
    if (key.length !== 32) throw new Error("release key length");
    return key;
  } catch (error) {
    if (error instanceof HowToError) throw error;
    throw new HowToError("RELEASE_KEY_UNWRAP_FAILED", "当前设备无法解包 release key。", { cause: error });
  }
}

export function decryptBundle(bundle, releaseKey, product, version) {
  const input = Buffer.from(bundle);
  if (input.length < BUNDLE_MAGIC.length + 12 + 16 || !input.subarray(0, 8).equals(BUNDLE_MAGIC)) {
    throw new HowToError("INVALID_ENCRYPTED_BUNDLE", "Encrypted bundle 格式无效。");
  }
  try {
    const iv = input.subarray(8, 20);
    const encrypted = input.subarray(20);
    const decipher = crypto.createDecipheriv("aes-256-gcm", releaseKey, iv);
    decipher.setAAD(Buffer.from(`howto-swt-bundle-v1\0${product}\0${version}`));
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    return Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  } catch (error) {
    throw new HowToError("BUNDLE_DECRYPT_FAILED", "Encrypted bundle 解密或 GCM 校验失败。", { cause: error });
  }
}
