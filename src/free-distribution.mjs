import { HowToError } from "./errors.mjs";

export const DEFAULT_FREE_MANIFEST_URL = "https://raw.githubusercontent.com/0x-howard/howto-swt/main/runtime-manifest.json";

async function fetchResponse(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs || 10_000) });
  } catch (error) {
    throw new HowToError("FREE_DISTRIBUTION_UNAVAILABLE", "无法从 GitHub 获取 HowTo SWT Free 分发文件。", { cause: error });
  }
}

export async function fetchFreeManifest(options = {}) {
  const env = options.env || process.env;
  const url = options.freeManifestUrl || env.HOWTO_FREE_MANIFEST_URL || DEFAULT_FREE_MANIFEST_URL;
  const response = await fetchResponse(url, options);
  if (!response.ok) throw new HowToError("FREE_MANIFEST_UNAVAILABLE", `Free manifest 返回 ${response.status}。`);
  const manifest = await response.json();
  if (manifest?.schema_version !== 1 || manifest.product !== "howto-swt"
      || !/^\d+\.\d+\.\d+$/.test(manifest.version)
      || !/^[a-f0-9]{64}$/.test(manifest.sha256 || "")
      || typeof manifest.asset_url !== "string" || !manifest.asset_url.startsWith("https://")) {
    throw new HowToError("INVALID_FREE_MANIFEST", "HowTo SWT Free Runtime manifest 格式无效。");
  }
  return manifest;
}

export async function downloadFreeArchive(manifest, options = {}) {
  const response = await fetchResponse(manifest.asset_url, options);
  if (!response.ok) throw new HowToError("FREE_ARCHIVE_UNAVAILABLE", `Free Runtime 返回 ${response.status}。`);
  return Buffer.from(await response.arrayBuffer());
}
