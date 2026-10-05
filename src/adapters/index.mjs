import { codexAdapter } from "./codex.mjs";
import { claudeAdapter } from "./claude.mjs";
import { genericAdapter } from "./generic.mjs";
import { workbuddyAdapter } from "./workbuddy.mjs";
import { doubaoWorkAdapter } from "./doubao-work.mjs";
import { HowToError } from "../errors.mjs";

const factories = {
  codex: codexAdapter,
  claude: claudeAdapter,
  "claude-code": claudeAdapter,
  workbuddy: workbuddyAdapter,
  "doubao-work": doubaoWorkAdapter,
  generic: genericAdapter,
};

export function resolveAdapter(options = {}) {
  let name = options.agent || options.env?.HOWTO_AGENT || process.env.HOWTO_AGENT || options.config?.agent;
  if (!name && options.installRoot) name = "generic";
  if (!name) {
    throw new HowToError(
      "NEEDS_CONFIGURATION",
      "无法可靠判断当前 Agent；请使用 --agent codex|claude|workbuddy|doubao-work|generic。",
    );
  }
  const factory = factories[String(name).toLowerCase()];
  if (!factory) throw new HowToError("UNSUPPORTED_AGENT", `不支持的 Agent：${name}`);
  return factory(options);
}
