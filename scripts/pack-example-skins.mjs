/**
 * 打包 example/skins/ 下的 v2 皮肤目录为同名 .zip（可直接导入的产物）。
 * 用法：npm run pack:skins（修改 example 内皮肤源文件后手动执行）。
 * zip 条目路径一律用正斜杠，条目按目录序写入，兼容 Rust staging 解包。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir, base = "") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(p).isDirectory()) {
      out.push(...walk(p, rel));
    } else {
      out.push([rel, new Uint8Array(readFileSync(p))]);
    }
  }
  return out;
}

const skinsDir = join(ROOT, "example", "skins");
let packed = 0;
for (const name of readdirSync(skinsDir).sort()) {
  const dir = join(skinsDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const files = walk(dir);
  const data = {};
  for (const [rel, bytes] of files) data[rel] = bytes;
  const zipped = zipSync(data, { level: 6 });
  const out = join(skinsDir, `${name}.zip`);
  writeFileSync(out, zipped);
  console.log(`✓ ${name}.zip（${files.length} 个文件，${zipped.length} 字节）`);
  packed++;
}
if (!packed) console.log("example/skins 下没有可打包的皮肤目录");
