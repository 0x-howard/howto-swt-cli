#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  const code = error?.code || "UNEXPECTED_ERROR";
  const message = error?.message || String(error);
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = error?.exitCode || 1;
});
