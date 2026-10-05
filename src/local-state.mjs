import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export function howtoHome(env = process.env) {
  return path.resolve(env.HOWTO_HOME || path.join(os.homedir(), ".howto"));
}

export function statePaths(env = process.env) {
  const root = howtoHome(env);
  return {
    root,
    auth: path.join(root, "auth.json"),
    config: path.join(root, "config.json"),
    updates: path.join(root, "update-state.json"),
    device: path.join(root, "device.json"),
    offlineDeviceKey: path.join(root, "offline-device-key.json"),
    offlineRequest: path.join(root, "offline-request.json"),
  };
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writePrivateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700).catch(() => {});
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600).catch(() => {});
  await rename(temporary, file);
}

export async function loadConfig(env = process.env) {
  return (await readJson(statePaths(env).config, {})) || {};
}

export async function loadAuth(product, env = process.env) {
  const auth = await readJson(statePaths(env).auth, null);
  return auth?.product === product ? auth : null;
}

export async function saveAuth(auth, env = process.env) {
  await writePrivateJson(statePaths(env).auth, auth);
}

export async function loadUpdateState(env = process.env) {
  return (await readJson(statePaths(env).updates, {})) || {};
}

export async function saveUpdateState(state, env = process.env) {
  await writePrivateJson(statePaths(env).updates, state);
}

export async function loadOrCreateDevice({ agent = "generic", env = process.env } = {}) {
  const file = statePaths(env).device;
  const existing = await readJson(file, null);
  if (existing?.device_id && /^[A-Za-z0-9_-]{16,128}$/.test(existing.device_id)) return existing;
  const device = {
    device_id: crypto.randomUUID(),
    device_name: `${String(agent || "generic").slice(0, 32)}-${process.platform}`,
    created_at: new Date().toISOString(),
  };
  await writePrivateJson(file, device);
  return device;
}

export async function loadOfflineDeviceKey(env = process.env) {
  return readJson(statePaths(env).offlineDeviceKey, null);
}

export async function loadOrCreateOfflineDeviceKey(env = process.env) {
  const existing = await loadOfflineDeviceKey(env);
  if (existing?.algorithm === "X25519" && existing.private_key_pkcs8 && existing.public_key_spki) return existing;
  const { generateX25519DeviceKey } = await import("./offline-crypto.mjs");
  const key = { ...generateX25519DeviceKey(), created_at: new Date().toISOString() };
  await writePrivateJson(statePaths(env).offlineDeviceKey, key);
  return key;
}

export async function loadOfflineRequest(env = process.env) {
  return readJson(statePaths(env).offlineRequest, null);
}

export async function saveOfflineRequest(request, env = process.env) {
  await writePrivateJson(statePaths(env).offlineRequest, request);
}
