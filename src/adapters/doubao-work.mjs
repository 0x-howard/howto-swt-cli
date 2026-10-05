import fs from "node:fs";
import path from "node:path";
import { HowToError } from "../errors.mjs";

const KNOWN_ROOTS = [
  "/home/user/.doubao/agent_mode/workspace/.skills",
  "/runtime/skills",
];

function writableDirectory(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.W_OK);
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

export function doubaoWorkAdapter({ env = process.env, installRoot } = {}) {
  const configured = installRoot || env.DOUBAO_WORK_SKILLS_ROOT;
  const root = configured || KNOWN_ROOTS.find(writableDirectory);
  if (!root) {
    throw new HowToError(
      "NEEDS_CONFIGURATION",
      "无法确认豆包 Work Skill 目录；请提供 --install-root（通常为 /home/user/.doubao/agent_mode/workspace/.skills 或 /runtime/skills）。",
    );
  }
  const resolved = path.resolve(root);
  if (!writableDirectory(resolved)) {
    throw new HowToError("INSTALL_ROOT_NOT_WRITABLE", `豆包 Work Skill 目录不可写：${resolved}`);
  }
  return {
    name: "doubao-work",
    root: resolved,
    destination(product) { return path.join(resolved, product); },
  };
}
