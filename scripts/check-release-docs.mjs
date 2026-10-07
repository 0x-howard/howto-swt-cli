#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const expectedTag = `v${packageJson.version}`;
const tagIndex = process.argv.indexOf("--tag");
const tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : null;
if (!readme.includes(`**${expectedTag}**`)) {
  throw new Error(`RELEASE_DOCS_CHECK_FAILED: README does not declare ${expectedTag}`);
}
if (tag && tag !== expectedTag) {
  throw new Error(`RELEASE_DOCS_CHECK_FAILED: ${tag} does not match ${expectedTag}`);
}
process.stdout.write(`RELEASE_DOCS_CHECK_OK: ${expectedTag}\n`);
