import path from "node:path";
import { HowToError } from "../errors.mjs";

export function workbuddyAdapter({ env = process.env, installRoot } = {}) {
  const root = installRoot || env.WORKBUDDY_SKILLS_ROOT;
  if (!root) {
    throw new HowToError(
      "NEEDS_CONFIGURATION",
      "WorkBuddy 的安装路径无法可靠自动判断；请提供 --install-root 或 WORKBUDDY_SKILLS_ROOT。",
    );
  }
  return {
    name: "workbuddy",
    root: path.resolve(root),
    destination(product) {
      return path.join(this.root, product);
    },
  };
}
