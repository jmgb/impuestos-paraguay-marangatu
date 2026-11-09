// Borra los checkpoints de depuración (artifacts/). No toca presentaciones/.
import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

import { rootDir } from "../src/state.js";

dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

const artifactsDir = path.resolve(rootDir, process.env.MARANGATU_ARTIFACTS_DIR || "artifacts");
const relative = path.relative(rootDir, artifactsDir);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
  console.error(`Se rechaza borrar fuera del proyecto: ${artifactsDir}`);
  process.exit(1);
}

const entries = await fs.readdir(artifactsDir).catch(error => {
  if (error.code === "ENOENT") return [];
  throw error;
});
for (const entry of entries) {
  await fs.rm(path.join(artifactsDir, entry), { recursive: true, force: true });
}
console.log(`Artifacts borrados (${entries.length}): ${artifactsDir}`);
