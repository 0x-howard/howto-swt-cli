import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { checkUpdate, getStatus, installProduct, updateProduct } from "./commands.mjs";
import { HowToError } from "./errors.mjs";

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
    if (["json", "auto"].includes(rawKey)) flags[rawKey] = true;
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

function printResult(result, json) {
  if (json) return stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "UPDATE_AVAILABLE") {
    return stdout.write(`🔔 HowTo SWT Pro 有新版本 v${result.latest_version}。\n本次更新：${result.summary}\n回复 1 即可更新。\n`);
  }
  if (result.status === "STATUS") {
    const installed = result.update_state?.installed_version || "not installed";
    const entitlement = result.entitlement?.status || (result.authenticated ? "unverified" : "not authenticated");
    const update = result.update || "unverified";
    return stdout.write(
      `HowTo SWT Pro\nInstalled: ${installed}\nEntitlement: ${entitlement}\nUpdate: ${update}\n`,
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
  };
  let result;
  if (command === "install") {
    result = await installProduct(product, { ...common, email: flags.email, code: flags.code, codeProvider: promptForCode });
  } else if (command === "update") {
    result = await updateProduct(product, common);
  } else if (command === "check-update") {
    result = await checkUpdate(product, { ...common, auto: Boolean(flags.auto) });
  } else if (command === "status") {
    result = await getStatus(common);
  } else {
    throw new HowToError(
      "USAGE",
      "用法：howto install howto-swt-pro --email EMAIL [--agent codex] | update howto-swt-pro | status | check-update howto-swt-pro",
      { exitCode: 2 },
    );
  }
  printResult(result, Boolean(flags.json));
  return result;
}
