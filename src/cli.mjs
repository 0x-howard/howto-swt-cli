import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { activateOffline, checkUpdate, getStatus, installProduct, updateProduct } from "./commands.mjs";
import { HowToError } from "./errors.mjs";
import { loadOfflineRequest } from "./local-state.mjs";

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split("=", 2);
    if (["json", "auto", "offline", "confirm-replace"].includes(rawKey)) flags[rawKey] = true;
    else flags[rawKey] = inline ?? argv[++index];
  }
  return { positionals, flags };
}

async function promptForCode() {
  if (!stdin.isTTY) throw new HowToError("OTP_REQUIRED", "非交互环境请使用 --code 提供验证码。");
  // OTPs are authentication secrets. Keep readline's terminal echo away from
  // stdout so interactive runs and captured logs never contain the code.
  const hiddenOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const input = readline.createInterface({ input: stdin, output: hiddenOutput, terminal: true });
  stdout.write("请输入邮件中的 6 位验证码（输入内容不会显示）：");
  try {
    const code = (await input.question("")).trim();
    stdout.write("\n");
    return code;
  } finally {
    input.close();
  }
}

async function promptForActivationToken() {
  if (!stdin.isTTY) throw new HowToError("ACTIVATION_TOKEN_REQUIRED", "非交互环境请使用 --activation-token 提供 Token。");
  const hiddenOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const input = readline.createInterface({ input: stdin, output: hiddenOutput, terminal: true });
  stdout.write("请粘贴 Activation Token（输入内容不会显示）：");
  try {
    const token = (await input.question("")).trim();
    stdout.write("\n");
    return token;
  } finally {
    input.close();
  }
}

function printResult(result, json) {
  if (json) return stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "UPDATE_AVAILABLE") {
    const label = result.product === "howto-swt" ? "HowTo SWT Free" : "HowTo SWT Pro";
    return stdout.write(`🔔 ${label} 有新版本 v${result.latest_version}。\n本次更新：${result.summary || "详见发布说明"}\n回复 1 即可更新。\n`);
  }
  if (result.status === "ENTITLEMENT_EXPIRED") {
    return stdout.write("当前已安装版本可以继续使用。\n检测到新版本，但会员更新权限已到期。\n");
  }
  if (result.status === "EDITION_REPLACE_CONFIRMATION_REQUIRED") {
    return stdout.write(
      `EDITION_REPLACE_CONFIRMATION_REQUIRED\nInstalled: ${result.installed_edition} v${result.installed_version}\nTarget: ${result.target_edition}\n确认替换后重新运行命令并加 --confirm-replace。\n`,
    );
  }
  if (result.status === "STATUS") {
    const installed = result.update_state?.installed_version || "not installed";
    const entitlement = result.entitlement?.status || (result.authenticated ? "unverified" : "not authenticated");
    const update = result.update || "unverified";
    return stdout.write(
      `HowTo SWT Pro\nInstalled: ${installed}\nEntitlement: ${entitlement}\nUpdate: ${update}\n`,
    );
  }
  if (result.status === "OFFLINE_ACTIVATION_REQUIRED") {
    return stdout.write(
      `OFFLINE_ACTIVATION_REQUIRED\nVersion: ${result.version}\nActivation URL:\n${result.activation_url}\n\nActivation Request:\n${result.activation_request}\n`,
    );
  }
  stdout.write(`${result.status}: ${result.product || "howto"}${result.version ? ` v${result.version}` : ""}\n`);
}

export async function main(argv) {
  const { positionals, flags } = parseArgs(argv);
  const [command, product] = positionals;
  const common = {
    agent: flags.agent,
    installRoot: flags["install-root"],
    baseUrl: flags["api-base-url"],
    manifestUrl: flags["manifest-url"],
    freeManifestUrl: flags["free-manifest-url"],
    activationUrl: flags["activation-url"],
    replaceConfirmed: Boolean(flags["confirm-replace"]),
  };
  let result;
  if (command === "install") {
    let activationToken = flags["activation-token"];
    if (flags.offline && !activationToken && await loadOfflineRequest(process.env)) activationToken = await promptForActivationToken();
    result = await installProduct(product, {
      ...common,
      email: flags.email,
      code: flags.code,
      codeProvider: promptForCode,
      offline: Boolean(flags.offline),
      activationToken,
    });
  } else if (command === "update") {
    result = await updateProduct(product, common);
  } else if (command === "check-update") {
    result = await checkUpdate(product, { ...common, auto: Boolean(flags.auto), offline: Boolean(flags.offline) });
  } else if (command === "activate") {
    result = await activateOffline(product, common);
  } else if (command === "status") {
    result = await getStatus(common);
  } else {
    throw new HowToError(
      "USAGE",
      "用法：howto install howto-swt|howto-swt-pro [--offline] [--confirm-replace] [--agent codex|workbuddy|doubao-work] | activate howto-swt-pro | update PRODUCT | status | check-update PRODUCT",
      { exitCode: 2 },
    );
  }
  printResult(result, Boolean(flags.json));
  return result;
}
