import os from "node:os";
import path from "node:path";

export function codexAdapter({ env = process.env, installRoot } = {}) {
  const root = installRoot || path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills");
  return {
    name: "codex",
    layout: "package",
    root: path.resolve(root),
    destination(product) {
      return path.join(this.root, product);
    },
  };
}
