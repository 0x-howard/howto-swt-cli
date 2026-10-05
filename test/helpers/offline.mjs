import crypto from "node:crypto";
import { BUNDLE_MAGIC, base64Url, publicKeyFingerprint } from "../../src/offline-crypto.mjs";

export function signingKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKeySpki: base64Url(publicKey.export({ format: "der", type: "spki" })),
  };
}

export function encryptedBundle(archive, product = "howto-swt-pro", version = "1.0.1", releaseKey = crypto.randomBytes(32)) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", releaseKey, iv);
  cipher.setAAD(Buffer.from(`howto-swt-bundle-v1\0${product}\0${version}`));
  const encrypted = Buffer.concat([cipher.update(archive), cipher.final(), cipher.getAuthTag()]);
  return { bundle: Buffer.concat([BUNDLE_MAGIC, iv, encrypted]), releaseKey };
}

export function activationToken({ request, releaseKey, privateKey, ciphertextSha256, assetUrl, version = request.requested_version, overrides = {} }) {
  const devicePublicKey = crypto.createPublicKey({ key: Buffer.from(request.device_public_key, "base64url"), format: "der", type: "spki" });
  const ephemeral = crypto.generateKeyPairSync("x25519");
  const shared = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: devicePublicKey });
  const payload = {
    token_version: 1,
    product: request.product,
    version,
    member_ref: "a".repeat(64),
    device_id: request.device_id,
    request_nonce: request.nonce,
    issued_at: "2026-10-05T00:00:00.000Z",
    entitlement_expires_at: "2027-09-15T23:59:59.999Z",
    encryption_version: "aes-256-gcm-v1",
    ciphertext_sha256: ciphertextSha256,
    asset_url: assetUrl,
    nonce: crypto.randomBytes(24).toString("base64url"),
    device_public_key_fingerprint: publicKeyFingerprint(request.device_public_key),
    ...overrides,
  };
  const info = Buffer.from(`howto-swt-offline-wrap-v1\0${payload.product}\0${payload.version}\0${payload.device_id}\0${payload.device_public_key_fingerprint}`);
  const salt = crypto.randomBytes(24);
  const iv = crypto.randomBytes(12);
  const kek = Buffer.from(crypto.hkdfSync("sha256", shared, salt, info, 32));
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  cipher.setAAD(info);
  const wrapped = Buffer.concat([cipher.update(releaseKey), cipher.final(), cipher.getAuthTag()]);
  Object.assign(payload, {
    ephemeral_public_key: base64Url(ephemeral.publicKey.export({ format: "der", type: "spki" })),
    hkdf_salt: base64Url(salt),
    wrap_iv: base64Url(iv),
    release_key_wrapped: base64Url(wrapped),
  });
  const encoded = base64Url(Buffer.from(JSON.stringify(payload)));
  return `hswact1.${encoded}.${base64Url(crypto.sign(null, Buffer.from(encoded), privateKey))}`;
}
