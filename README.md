# HowTo SWT CLI

`howto-swt-cli` 是免费的 HowTo SWT Pro 安装与更新工具。HowTo SWT Pro 仅向有资格的陪跑营会员开放；用户使用登记邮箱和邮件 OTP 完成认证。

## 当前 Pilot

当前公开版本用于测试 / Pilot，尚未接入 production。运行命令时必须通过 `HOWTO_API_BASE_URL` 明确指定 Pilot API；CLI 不会把 staging 伪装成 production。

目前的公开分发渠道是 GitHub，不是 npm Registry。

## 命令

```bash
# 首次安装：请求邮件验证码，验证后下载并安装
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y github:0x-howard/howto-swt-cli \
  install howto-swt-pro --email user@example.com --agent codex

# 明确更新：会重新检查会员资格并在成功校验后替换
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y github:0x-howard/howto-swt-cli update howto-swt-pro --agent codex

# 查看本机授权、安装和版本状态；配置 API 后也核验会员与最新版
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y github:0x-howard/howto-swt-cli status --agent codex

# 手动检查版本；只报告，不安装
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y github:0x-howard/howto-swt-cli check-update howto-swt-pro

# Pro hook 使用；24 小时内不会再次请求，服务不可用时静默跳过
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y github:0x-howard/howto-swt-cli check-update howto-swt-pro --auto --json
```

仓库公开后，`npx -y github:0x-howard/howto-swt-cli ...` 会从 GitHub 获取 CLI。本地开发可用：

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
└── device.json        # 随机稳定 device_id；不使用硬件指纹
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
