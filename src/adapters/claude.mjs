import os from "node:os";
import path from "node:path";

export function claudeAdapter({ env = process.env, installRoot } = {}) {
  const root = installRoot || path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "skills");
  return {
    name: "claude",
    layout: "package",
    root: path.resolve(root),
    destination(product) {
      return path.join(this.root, product);
    },
  };
}
