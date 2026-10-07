import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOfflineActivationRequest, installOfflineProduct } from "../src/offline.mjs";
import { decodeJson, REQUEST_PREFIX, sha256Hex } from "../src/offline-crypto.mjs";
import { statePaths, writePrivateJson } from "../src/local-state.mjs";
import { packageZip } from "./helpers/zip.mjs";
import { activationToken, encryptedBundle, signingKeys } from "./helpers/offline.mjs";

const product = "howto-swt-pro";
const assetUrl = "https://raw.githubusercontent.com/example/dist/main/releases/1.0.1/bundle";

function response(body, status = 200) {
  return new Response(body instanceof Buffer ? body : JSON.stringify(body), { status, headers: { "content-type": body instanceof Buffer ? "application/octet-stream" : "application/json" } });
}

async function scenario() {
  const root = await mkdtemp(path.join(os.tmpdir(), "howto-offline-"));
  const env = { HOWTO_HOME: path.join(root, ".howto") };
  const archive = packageZip("1.0.1");
  const encrypted = encryptedBundle(archive);
  const manifest = { schema_version: 1, product, latest: "1.0.1", releases: { "1.0.1": { version: "1.0.1", summary: "Pilot", encryption_version: "aes-256-gcm-v1", ciphertext_sha256: sha256Hex(encrypted.bundle), asset_url: assetUrl } } };
  const fetchImpl = async (url) => url === assetUrl ? response(encrypted.bundle) : response(manifest);
  const requestResult = await createOfflineActivationRequest(product, { env, fetchImpl, requestedVersion: "1.0.1", now: () => Date.parse("2026-10-05T00:00:00Z") });
  const request = decodeJson(requestResult.activation_request, REQUEST_PREFIX);
  const keys = signingKeys();
  const token = activationToken({ request, releaseKey: encrypted.releaseKey, privateKey: keys.privateKey, ciphertextSha256: sha256Hex(encrypted.bundle), assetUrl });
  return { root, env, archive, encrypted, manifest, fetchImpl, requestResult, request, keys, token };
}

test("offline request persists one X25519 device key with private permissions", async () => {
  const first = await scenario();
  const firstKey = JSON.parse(await readFile(statePaths(first.env).offlineDeviceKey));
  await createOfflineActivationRequest(product, { env: first.env, fetchImpl: first.fetchImpl, now: () => Date.parse("2026-10-05T00:01:00Z") });
  const secondKey = JSON.parse(await readFile(statePaths(first.env).offlineDeviceKey));
  assert.equal(firstKey.private_key_pkcs8, secondKey.private_key_pkcs8);
  assert.equal(firstKey.public_key_spki, secondKey.public_key_spki);
  assert.equal((await stat(statePaths(first.env).offlineDeviceKey)).mode & 0o777, 0o600);
});

test("valid activation token unwraps, decrypts, safely installs, and cleans staging", async () => {
  const f = await scenario();
  const installRoot = path.join(f.root, "skills");
  await chmod(f.root, 0o700);
  const result = await installOfflineProduct(product, { env: f.env, fetchImpl: f.fetchImpl, activationToken: f.token, signingPublicKey: f.keys.publicKeySpki, agent: "generic", installRoot });
  assert.equal(result.status, "INSTALLED");
  assert.equal(result.activation, "offline");
  assert.match(await readFile(path.join(installRoot, "howto-swt", "skills/swt/SKILL.md"), "utf8"), /1\.0\.1/);
  await assert.rejects(access(statePaths(f.env).offlineRequest), { code: "ENOENT" });
  assert.equal((await readdir(installRoot)).some((name) => name.includes(".stage-") || name.includes(".backup-")), false);
});

test("copied token is rejected on a second device", async () => {
  const f = await scenario();
  const other = await scenario();
  await writePrivateJson(statePaths(other.env).offlineRequest, { ...f.request, activation_request: f.requestResult.activation_request });
  await assert.rejects(installOfflineProduct(product, { env: other.env, fetchImpl: f.fetchImpl, activationToken: f.token, signingPublicKey: f.keys.publicKeySpki, agent: "generic", installRoot: path.join(other.root, "skills") }), { code: "WRONG_DEVICE" });
});

test("tampered token and signed wrong version are rejected", async () => {
  const f = await scenario();
  const parts = f.token.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  const tampered = parts.join(".");
  await assert.rejects(installOfflineProduct(product, { env: f.env, fetchImpl: f.fetchImpl, activationToken: tampered, signingPublicKey: f.keys.publicKeySpki, agent: "generic", installRoot: path.join(f.root, "a") }), { code: "INVALID_ACTIVATION_SIGNATURE" });
  const wrongVersion = activationToken({ request: f.request, releaseKey: f.encrypted.releaseKey, privateKey: f.keys.privateKey, ciphertextSha256: sha256Hex(f.encrypted.bundle), assetUrl, version: "1.0.2" });
  await assert.rejects(installOfflineProduct(product, { env: f.env, fetchImpl: f.fetchImpl, activationToken: wrongVersion, signingPublicKey: f.keys.publicKeySpki, agent: "generic", installRoot: path.join(f.root, "b") }), { code: "ACTIVATION_TOKEN_MISMATCH" });
});

test("tampered bundle fails SHA and wrong release key fails GCM", async () => {
  const first = await scenario();
  const changed = Buffer.from(first.encrypted.bundle); changed[changed.length - 1] ^= 1;
  const tamperedFetch = async (url) => url === assetUrl ? response(changed) : response(first.manifest);
  await assert.rejects(installOfflineProduct(product, { env: first.env, fetchImpl: tamperedFetch, activationToken: first.token, signingPublicKey: first.keys.publicKeySpki, agent: "generic", installRoot: path.join(first.root, "a") }), { code: "BUNDLE_SHA256_MISMATCH" });

  const second = await scenario();
  const wrongKeyToken = activationToken({ request: second.request, releaseKey: Buffer.alloc(32, 7), privateKey: second.keys.privateKey, ciphertextSha256: sha256Hex(second.encrypted.bundle), assetUrl });
  await assert.rejects(installOfflineProduct(product, { env: second.env, fetchImpl: second.fetchImpl, activationToken: wrongKeyToken, signingPublicKey: second.keys.publicKeySpki, agent: "generic", installRoot: path.join(second.root, "b") }), { code: "BUNDLE_DECRYPT_FAILED" });
});
