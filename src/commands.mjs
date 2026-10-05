import { ApiClient } from "./api-client.mjs";
import { resolveAdapter } from "./adapters/index.mjs";
import { installArchive, verifyInstalledPackage } from "./installer.mjs";
import { compareVersions } from "./semver.mjs";
import {
  loadAuth,
  loadConfig,
  loadOrCreateDevice,
  loadUpdateState,
  saveAuth,
  saveUpdateState,
} from "./local-state.mjs";
import { HowToError } from "./errors.mjs";

export const SUPPORTED_PRODUCT = "howto-swt-pro";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function requireProduct(product) {
  if (product !== SUPPORTED_PRODUCT) throw new HowToError("UNSUPPORTED_PRODUCT", `不支持的产品：${product}`);
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HowToError("INVALID_EMAIL", "邮箱格式无效。");
  }
  return email;
}

async function context(options = {}) {
  const env = options.env || process.env;
  const config = options.config || await loadConfig(env);
  const baseUrl = options.baseUrl || env.HOWTO_API_BASE_URL || config.api_base_url;
  return { env, config, baseUrl };
}

function makeApi({ baseUrl, fetchImpl, token }) {
  return new ApiClient({ baseUrl, fetchImpl, token });
}

export async function installProduct(product, options = {}) {
  requireProduct(product);
  if (!options.email) throw new HowToError("EMAIL_REQUIRED", "首次安装需要 --email。");
  const email = normalizeEmail(options.email);
  const ctx = await context(options);
  const authApi = makeApi({ ...ctx, fetchImpl: options.fetchImpl });
  await authApi.requestCode(email, product);
  const code = options.code || await options.codeProvider?.();
  if (!code) throw new HowToError("OTP_REQUIRED", "需要输入 6 位验证码。");
  const device = await loadOrCreateDevice({ agent: options.agent || ctx.config.agent || "generic", env: ctx.env });
  const verified = await authApi.verifyCode(email, product, String(code), device);
  const auth = {
    product,
    email: verified.email,
    session_token: verified.session_token,
    issued_at: verified.issued_at,
    expires_at: verified.expires_at,
    device_id: device.device_id,
    device_name: device.device_name,
  };
  await saveAuth(auth, ctx.env);
  const api = makeApi({ ...ctx, fetchImpl: options.fetchImpl, token: auth.session_token });
  const entitlement = await api.entitlement();
  if (entitlement.status !== "active" || !entitlement.updates_allowed) {
    throw new HowToError("ENTITLEMENT_REQUIRED", "当前会员资格不允许安装最新版。");
  }
  const latest = await api.latest(product);
  const archive = await api.download(product, latest.version);
  const adapter = resolveAdapter({
    agent: options.agent,
    installRoot: options.installRoot,
    config: ctx.config,
    env: ctx.env,
  });
  const installed = await installArchive({
    archive,
    expectedSha256: latest.sha256,
    product,
    version: latest.version,
    destination: adapter.destination(product),
    verify: options.verify,
  });
  const state = await loadUpdateState(ctx.env);
  state[product] = {
    installed_version: latest.version,
    last_checked: new Date(options.now?.() || Date.now()).toISOString(),
    latest_seen: latest.version,
  };
  await saveUpdateState(state, ctx.env);
  return { status: "INSTALLED", product, agent: adapter.name, ...installed };
}

export async function updateProduct(product, options = {}) {
  requireProduct(product);
  const ctx = await context(options);
  const auth = await loadAuth(product, ctx.env);
  if (!auth?.session_token) throw new HowToError("AUTH_REQUIRED", "请先安装并完成邮箱验证。");
  const api = makeApi({ ...ctx, fetchImpl: options.fetchImpl, token: auth.session_token });
  const entitlement = await api.entitlement();
  if (entitlement.status !== "active" || !entitlement.updates_allowed) {
    throw new HowToError("ENTITLEMENT_EXPIRED", "会员已到期或被撤销；已安装版本继续可用，但不能获取更新。");
  }
  const latest = await api.latest(product);
  const state = await loadUpdateState(ctx.env);
  const current = state[product]?.installed_version;
  if (current && compareVersions(current, latest.version) >= 0) {
    state[product] = { ...state[product], last_checked: new Date(options.now?.() || Date.now()).toISOString(), latest_seen: latest.version };
    await saveUpdateState(state, ctx.env);
    return { status: "UP_TO_DATE", product, current_version: current, latest_version: latest.version };
  }
  const archive = await api.download(product, latest.version);
  const adapter = resolveAdapter({ agent: options.agent, installRoot: options.installRoot, config: ctx.config, env: ctx.env });
  const installed = await installArchive({
    archive,
    expectedSha256: latest.sha256,
    product,
    version: latest.version,
    destination: adapter.destination(product),
    verify: options.verify,
  });
  state[product] = {
    installed_version: latest.version,
    last_checked: new Date(options.now?.() || Date.now()).toISOString(),
    latest_seen: latest.version,
  };
  await saveUpdateState(state, ctx.env);
  return { status: "UPDATED", product, from_version: current || null, ...installed };
}

export async function checkUpdate(product, options = {}) {
  requireProduct(product);
  const ctx = await context(options);
  const nowMs = options.now?.() || Date.now();
  const state = await loadUpdateState(ctx.env);
  const productState = state[product] || {};
  const previous = Date.parse(productState.last_checked || "");
  if (options.auto && Number.isFinite(previous) && nowMs - previous < CHECK_INTERVAL_MS) {
    return { status: "CHECK_SKIPPED_CACHED", product, last_checked: productState.last_checked };
  }
  // A failed automatic attempt still counts as a check. This prevents an offline
  // server from being retried on every Skill invocation and preserves the 24h cap.
  state[product] = { ...productState, last_checked: new Date(nowMs).toISOString() };
  await saveUpdateState(state, ctx.env);
  try {
    const auth = await loadAuth(product, ctx.env);
    if (!auth?.session_token) throw new HowToError("AUTH_REQUIRED", "尚未完成授权。");
    const api = makeApi({ ...ctx, fetchImpl: options.fetchImpl, token: auth.session_token });
    const entitlement = await api.entitlement();
    if (!entitlement.updates_allowed) {
      return { status: "ENTITLEMENT_EXPIRED", product, current_version: productState.installed_version || null };
    }
    const latest = await api.latest(product);
    state[product] = { ...state[product], latest_seen: latest.version };
    await saveUpdateState(state, ctx.env);
    const current = productState.installed_version;
    if (current && compareVersions(current, latest.version) < 0) {
      return {
        status: "UPDATE_AVAILABLE",
        product,
        current_version: current,
        latest_version: latest.version,
        summary: latest.summary,
      };
    }
    return { status: "UP_TO_DATE", product, current_version: current || null, latest_version: latest.version };
  } catch (error) {
    if (options.auto) return { status: "CHECK_SKIPPED_UNAVAILABLE", product };
    throw error;
  }
}

export async function getStatus(options = {}) {
  const ctx = await context(options);
  const auth = await loadAuth(SUPPORTED_PRODUCT, ctx.env);
  const state = await loadUpdateState(ctx.env);
  let installation = null;
  let entitlement = null;
  let latestVersion = null;
  let update = null;
  try {
    const adapter = resolveAdapter({ agent: options.agent, installRoot: options.installRoot, config: ctx.config, env: ctx.env });
    const version = state[SUPPORTED_PRODUCT]?.installed_version;
    if (version) {
      await verifyInstalledPackage(adapter.destination(SUPPORTED_PRODUCT), { product: SUPPORTED_PRODUCT, version });
      installation = { agent: adapter.name, destination: adapter.destination(SUPPORTED_PRODUCT), verified: true };
    }
  } catch (error) {
    installation = { verified: false, reason: error.code || error.message };
  }
  if (auth?.session_token && ctx.baseUrl) {
    try {
      const api = makeApi({ ...ctx, fetchImpl: options.fetchImpl, token: auth.session_token });
      entitlement = await api.entitlement();
      if (entitlement.updates_allowed) {
        const latest = await api.latest(SUPPORTED_PRODUCT);
        latestVersion = latest.version;
        const current = state[SUPPORTED_PRODUCT]?.installed_version;
        update = current && compareVersions(current, latest.version) < 0 ? "available" : "current";
      } else {
        update = "not allowed";
      }
    } catch (error) {
      entitlement = { status: "unverified", reason: error.code || error.message };
      update = "unverified";
    }
  }
  return {
    status: "STATUS",
    product: SUPPORTED_PRODUCT,
    authenticated: Boolean(auth?.session_token),
    email: auth?.email || null,
    update_state: state[SUPPORTED_PRODUCT] || null,
    installation,
    entitlement,
    latest_version: latestVersion,
    update,
  };
}
