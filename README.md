# HowTo SWT CLI

**v0.3.0** · [Free](https://github.com/0x-howard/howto-swt) · [Pro Dist](https://github.com/0x-howard/howto-swt-pro-dist)

`howto-swt-cli` 是 HowTo SWT 的受控 Runtime installer。Free 仍来自公开 GitHub source，不会被改成会员分发；CLI 为 WorkBuddy 等需要 hard guard 的场景安装 Free，并为 Pro 提供 Online OTP 与 device-bound Offline Activation。

## Runtime Identity 与 Edition Guard

package adapter 的 canonical 目录是 `<skills-root>/howto-swt`；WorkBuddy 是 `~/.workbuddy/skills/` 下的 flat-six skills。两者都写入 `.howto-runtime.json`：

```json
{
  "schema_version": 1,
  "product": "howto-swt",
  "edition": "free",
  "version": "1.2.0",
  "managed_by": "howto-swt-cli",
  "installed_at": "ISO-8601"
}
```

不同 Edition 不会直接覆盖。CLI 返回 `EDITION_REPLACE_CONFIRMATION_REQUIRED`，用户明确确认后才可加 `--confirm-replace` 再执行。检测与更新检查永远不修改 Runtime。

## 命令

```bash
# Free：公开 manifest + release ZIP，主要用于 WorkBuddy hard guard
npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  install howto-swt --agent workbuddy

# Pro Online Pilot：当前仍必须显式提供 staging API，不冒充 Production
HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  install howto-swt-pro --email user@example.com --agent codex

# 只检查，不安装；自动模式有 24 小时 cache，网络失败 fail-open
npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  check-update howto-swt --auto --json

HOWTO_API_BASE_URL="https://howto-swt-api-staging.howto-cloud.workers.dev" \
  npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  check-update howto-swt-pro --auto --json

# 已确认跨 Edition 替换后，才可执行 APPLY
npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  install howto-swt --agent workbuddy --confirm-replace
```

## Pro Offline Activation

```bash
# 1. 在受限 Agent 生成 device-bound request
npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  activate howto-swt-pro --agent doubao-work

# 2. 在用户自己的浏览器完成 OTP，取得 Activation Token
# 3. 回到同一设备安装
npx -y --allow-git=root github:0x-howard/howto-swt-cli \
  install howto-swt-pro --offline --agent doubao-work
```

CLI 在本地验签、核对 product/version/request/device binding、验证 encrypted bundle SHA-256、解密后复用同一套 Runtime installer。私钥只保存在 `~/.howto/offline-device-key.json`（`0600`）；release key、OTP 和明文 ZIP 不写入日志或公开缓存。会员更新资格到期后，已安装 Pro 仍可继续使用。

## Adapter

| Agent | Runtime root / layout |
|---|---|
| Codex | `$CODEX_HOME/skills/howto-swt` 或 `~/.codex/skills/howto-swt` |
| Claude Code | `$CLAUDE_CONFIG_DIR/skills/howto-swt` 或 `~/.claude/skills/howto-swt` |
| WorkBuddy | `~/.workbuddy/skills/`；flat six + root identity marker |
| 豆包 Work | 已知 `.skills` root；无法识别时要求 `--install-root` |
| Generic | 必须提供 `--install-root` 或 `HOWTO_SKILLS_ROOT` |

## 原子安装与状态

流程为 detect → confirmation → stage → validate → backup → replace → verify → cleanup；失败恢复旧 Runtime 并返回 `INSTALL_ROLLED_BACK`。机器状态包括：

`EDITION_CONFLICT`、`EDITION_REPLACE_CONFIRMATION_REQUIRED`、`UPDATE_AVAILABLE`、`UP_TO_DATE`、`CHECK_SKIPPED_CACHED`、`CHECK_SKIPPED_UNAVAILABLE`、`ENTITLEMENT_EXPIRED`、`INSTALL_ROLLED_BACK`。

## 本机数据

CLI 的 auth/config/update/device 文件位于 `~/.howto/`，目录尽可能为 `0700`、文件为 `0600`。`USER_DATA_ROOT` 与 Runtime package 分离，安装和更新不得触碰 Profile、Offer、English、Visa 或其他用户上下文。

## 验证

```bash
npm test
npm run public:check
```

测试不需要 Cloudflare、R2 或 Resend 凭证。Production Cloud 本轮未修改。
