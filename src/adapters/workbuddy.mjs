import os from "node:os";
import path from "node:path";

export function workbuddyAdapter({ env = process.env, installRoot } = {}) {
  const home = env.HOME || os.homedir();
  const root = installRoot || env.WORKBUDDY_SKILLS_ROOT || path.join(home, ".workbuddy", "skills");
  return {
    name: "workbuddy",
    layout: "flat-six",
    root: path.resolve(root),
    destination(product) {
      return path.join(this.root, product);
    },
  };
}
