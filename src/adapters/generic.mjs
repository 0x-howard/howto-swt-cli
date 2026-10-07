import path from "node:path";
import { HowToError } from "../errors.mjs";

export function genericAdapter({ env = process.env, installRoot } = {}) {
  const root = installRoot || env.HOWTO_SKILLS_ROOT;
  if (!root) {
    throw new HowToError(
      "NEEDS_CONFIGURATION",
      "Generic Agent 需要 --install-root 或 HOWTO_SKILLS_ROOT；CLI 不会猜测安装路径。",
    );
  }
  return {
    name: "generic",
    layout: "package",
    root: path.resolve(root),
    destination(product) {
      return path.join(this.root, product);
    },
  };
}
