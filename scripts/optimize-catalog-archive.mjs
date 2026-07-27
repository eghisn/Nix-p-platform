import fs from "node:fs/promises";
import path from "node:path";
import sharp from "file:///C:/Users/neo-jagur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/lib/index.js";

const root = process.cwd();
const directory = path.join(root, "public", "assets", "catalog-archive");
const files = (await fs.readdir(directory)).filter((file) => /\.(jpe?g|png)$/i.test(file));

for (const file of files) {
  const source = path.join(directory, file);
  const target = source.replace(/\.(jpe?g|png)$/i, ".webp");
  await sharp(source)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, effort: 5 })
    .toFile(target);
  await fs.unlink(source);
  process.stdout.write(`${path.basename(target)}\n`);
}
