# HowTo SWT CLI

`howto-swt-cli` 是免费的 HowTo SWT Pro 安装与更新工具。HowTo SWT Pro 仅向有资格的陪跑营会员开放；用户使用登记邮箱和邮件 OTP 完成认证。

## 当前 Pilot

当前公开版本用于测试 / Pilot，尚未接入 production。运行命令时必须通过 `HOWTO_API_BASE_URL` 明确指定 Pilot API；CLI 不会把 staging 伪装成 production。

目前的公开分发渠道是 GitHub，不是 npm Registry。

CLI 保留两条明确分开的路径：

- 正常网络环境使用 Online OTP，由 CLI 连接 HowTo Cloud 并从 private R2 安装。
- 豆包 Work 等无法访问 HowTo Cloud 的受限沙箱使用 Offline Activation。沙箱只访问 GitHub；邮箱 OTP 在用户自己的浏览器完成。

## 命令

```bash
# 首次安装：请求邮件验证码，验证后下载并安装
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  install howto-swt-pro --email user@example.com --agent codex

# 明确更新：会重新检查会员资格并在成功校验后替换
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y --allow-git=root github:0x-howard/howto-swt-cli update howto-swt-pro --agent codex

# 查看本机授权、安装和版本状态；配置 API 后也核验会员与最新版
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y --allow-git=root github:0x-howard/howto-swt-cli status --agent codex

# 手动检查版本；只报告，不安装
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y --allow-git=root github:0x-howard/howto-swt-cli check-update howto-swt-pro

# Pro hook 使用；24 小时内不会再次请求，服务不可用时静默跳过
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y --allow-git=root github:0x-howard/howto-swt-cli check-update howto-swt-pro --auto --json
```

如果 Online API 在 DNS、TCP、TLS 或超时阶段不可达，CLI 返回 `ONLINE_ENDPOINT_UNAVAILABLE` 并提示 Offline Activation；不会静默降级。

## Offline Activation（豆包 Work）

第一步，在受限沙箱生成设备绑定的 Activation Request：

```bash
npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  activate howto-swt-pro --agent doubao-work
```

CLI 会生成并保存一对 X25519 device keys，私钥只存放在 `~/.howto/offline-device-key.json`，权限为 `0600`。输出包含一段可复制的 Activation Request 和浏览器 URL。

第二步，在用户自己的手机或正常浏览器打开该 URL，粘贴 Activation Request，使用陪跑营登记邮箱完成 OTP，然后复制页面生成的 Activation Token。不要在豆包沙箱中访问 activation page。

第三步，在同一豆包环境重新运行安装命令并按提示粘贴 Token：

```bash
npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  install howto-swt-pro --offline --agent doubao-work
```

CLI 会在本地验签，确认 product、version、request 和 device binding，从公开的 [`howto-swt-dist`](https://github.com/0x-howard/howto-swt-dist) 下载加密 Bundle，校验 ciphertext SHA-256，解包 device-bound release key，执行 AES-256-GCM 解密，再沿用安全 ZIP 安装流程。release key 和明文 ZIP 不会写入日志或公共缓存。

豆包 Work 会依次检测以下已知 Skill 根目录：

- `/home/user/.doubao/agent_mode/workspace/.skills`
- `/runtime/skills`

无法可靠识别或目录不可写时，必须增加 `--install-root /实际/skills/目录`。最终安装目录是 `<skill-root>/howto-swt-pro`。

Offline 更新检查使用 GitHub manifest：

```bash
npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  check-update howto-swt-pro --offline
```

每个新版本使用新的 release key，因此新版本需要重新取得 Activation Token；会员到期后已安装版本继续可用，但无法激活新版本。

`--allow-git=root` 是 npm 12 从 GitHub 获取这个根包所需的最小授权；它不会允许任意传递依赖从 Git 获取。上述命令会从 GitHub 获取 CLI，不使用本地源码或 npm Registry。本地开发可用：

```bash
/path/to/node ./bin/howto.mjs status --agent codex
```

## 本机配置

默认使用 `~/.howto/`：

```text
~/.howto/
├── auth.json          # email、opaque session token、issued_at
├── config.json        # API 地址、默认 Agent、可选安装路径
├── update-state.json  # 已安装版本、上次检查时间、最近看到的版本
├── device.json        # 随机稳定 device_id；不使用硬件指纹
├── offline-device-key.json # X25519 本机私钥与公钥；仅本机保存
└── offline-request.json    # 当前待完成的设备激活请求
```

目录尽可能设为 `0700`，JSON 文件为 `0600`。不保存密码和 OTP。不要把这个目录放进源码仓库或同步到公开位置。

首次 OTP 验证时 CLI 生成随机 UUID 作为稳定设备标识，并随 session 请求发送。每名会员最多 2 个 active devices；第三个设备不会挤掉旧设备，而是返回 `DEVICE_LIMIT_REACHED`，由管理员撤销不再使用的 session 后重试。

示例 `config.json`：

```json
{
  "api_base_url": "https://howto-swt-api-staging.howto-cloud.workers.dev",
  "agent": "codex"
}
```

也可用 `HOWTO_API_BASE_URL`、`HOWTO_AGENT`、`HOWTO_HOME` 覆盖。优先级是命令行、环境变量、本机配置。

## Agent adapters

安装路径不在主流程硬编码：

- `codex`：`$CODEX_HOME/skills/howto-swt-pro`，未设置时使用 Codex 标准目录 `~/.codex/skills/howto-swt-pro`。
- `claude`：`$CLAUDE_CONFIG_DIR/skills/howto-swt-pro`，未设置时使用 Claude Code 标准目录 `~/.claude/skills/howto-swt-pro`。
- `workbuddy`：真实路径不能可靠判断，必须提供 `--install-root` 或 `WORKBUDDY_SKILLS_ROOT`。
- `doubao-work`：检测豆包 Work 的已知 Skill 根目录；无法确认时必须提供 `--install-root` 或 `DOUBAO_WORK_SKILLS_ROOT`。
- `generic`：必须提供 `--install-root` 或 `HOWTO_SKILLS_ROOT`。

若无法可靠判断当前 Agent，CLI 返回 `NEEDS_CONFIGURATION`，不会猜路径。

## 安装与回滚安全

CLI 在替换前验证整个 ZIP 的 SHA-256；解压器拒绝绝对路径、`..`、重复路径、符号链接、加密条目和超限压缩包。新包先进入同盘临时目录并验证产品、版本和主 Skill，再以目录 rename 替换。旧包只在新包验证成功后删除；失败会自动恢复。

CLI 只替换 Agent Skill 目录下的 `howto-swt-pro` 包。`USER_DATA_ROOT`、测评历史、Offer、Profile 和练习记录必须位于包外，因此更新不会触碰这些数据。

## 更新语义

`check-update` 返回机器可读状态：`UPDATE_AVAILABLE`、`UP_TO_DATE`、`CHECK_SKIPPED_CACHED`、`CHECK_SKIPPED_UNAVAILABLE` 或 `ENTITLEMENT_EXPIRED`。自动检查最多每 24 小时请求一次；即使发现新版本也只提醒。只有用户在明确更新提示语境中确认后，Agent 才调用 `update`。

## 测试

```bash
npm run public:check
npm test
```

测试不需要 Cloudflare、R2 或 Resend 凭证。
