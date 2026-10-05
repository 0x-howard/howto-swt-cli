import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { HowToError } from "./errors.mjs";

const MAX_ENTRIES = 5000;
const MAX_ENTRY_SIZE = 100 * 1024 * 1024;
const MAX_TOTAL_SIZE = 250 * 1024 * 1024;

function locateEndRecord(buffer) {
  const floor = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= floor; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new HowToError("UNSAFE_ZIP", "ZIP 缺少有效的中央目录。");
}

function safeRelativeName(rawName) {
  if (rawName.includes("\0")) throw new HowToError("UNSAFE_ZIP", "ZIP 文件名包含 NUL。");
  const slashName = rawName.replace(/\\/g, "/");
  if (slashName.startsWith("/") || /^[A-Za-z]:/.test(slashName)) {
    throw new HowToError("UNSAFE_ZIP", `ZIP 包含绝对路径：${rawName}`);
  }
  const parts = slashName.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) throw new HowToError("UNSAFE_ZIP", `ZIP 路径越界：${rawName}`);
  return parts.join("/");
}

export async function extractZipSecure(buffer, destination) {
  const eocd = locateEndRecord(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES || centralOffset + centralSize > buffer.length) {
    throw new HowToError("UNSAFE_ZIP", "ZIP 中央目录超出安全限制。");
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const root = path.resolve(destination);
  let offset = centralOffset;
  let total = 0;
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new HowToError("UNSAFE_ZIP", "ZIP 中央目录损坏。");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new HowToError("UNSAFE_ZIP", "不接受加密 ZIP 条目。");
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) throw new HowToError("UNSAFE_ZIP", `不接受符号链接：${rawName}`);
    const relative = safeRelativeName(rawName);
    if (!relative) continue;
    const isDirectory = rawName.endsWith("/");
    if (seen.has(relative)) throw new HowToError("UNSAFE_ZIP", `ZIP 包含重复路径：${relative}`);
    seen.add(relative);
    if (size > MAX_ENTRY_SIZE || (total += size) > MAX_TOTAL_SIZE) {
      throw new HowToError("UNSAFE_ZIP", "ZIP 解压大小超出安全限制。");
    }
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new HowToError("UNSAFE_ZIP", `ZIP 路径逃逸：${relative}`);
    }
    if (isDirectory) {
      await mkdir(target, { recursive: true, mode: 0o755 });
      continue;
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new HowToError("UNSAFE_ZIP", "ZIP 本地条目损坏。");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_SIZE });
    else throw new HowToError("UNSAFE_ZIP", `不支持 ZIP 压缩方法 ${method}。`);
    if (data.length !== size) throw new HowToError("UNSAFE_ZIP", `ZIP 条目大小不一致：${relative}`);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await writeFile(target, data, { mode: unixMode & 0o111 ? 0o755 : 0o644 });
  }
}
