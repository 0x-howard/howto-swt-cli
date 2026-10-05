import { HowToError } from "./errors.mjs";

function cleanBaseUrl(value) {
  if (!value) throw new HowToError("NEEDS_CONFIGURATION", "缺少 API 地址；请设置 HOWTO_API_BASE_URL 或 config.json。api_base_url。");
  return value.replace(/\/+$/, "");
}

export class ApiClient {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, token = null }) {
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.fetch = fetchImpl;
    this.token = token;
  }

  async request(pathname, { method = "GET", body, binary = false, token = this.token } = {}) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      throw new HowToError("ONLINE_ENDPOINT_UNAVAILABLE", "无法连接 HowTo Cloud；可改用明确的 --offline 激活流程。", { cause: error });
    }
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch {}
      throw new HowToError(payload.code || "API_ERROR", payload.message || `服务返回 ${response.status}`, {
        status: response.status,
        details: payload,
      });
    }
    if (binary) return Buffer.from(await response.arrayBuffer());
    return response.status === 204 ? null : response.json();
  }

  requestCode(email, product) {
    return this.request("/v1/auth/request-code", { method: "POST", body: { email, product }, token: null });
  }

  verifyCode(email, product, code, device = {}) {
    return this.request("/v1/auth/verify-code", {
      method: "POST",
      body: { email, product, code, device_id: device.device_id, device_name: device.device_name },
      token: null,
    });
  }

  entitlement() {
    return this.request("/v1/entitlement");
  }

  latest(product) {
    return this.request(`/v1/products/${encodeURIComponent(product)}/latest`);
  }

  download(product, version) {
    return this.request(`/v1/products/${encodeURIComponent(product)}/download/${encodeURIComponent(version)}`, { binary: true });
  }
}
