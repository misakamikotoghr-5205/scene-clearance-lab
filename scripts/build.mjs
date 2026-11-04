import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const check = spawnSync(process.execPath, ["scripts/check.mjs"], {
  stdio: "inherit",
});
if (check.status) process.exit(check.status);
const output = "dist";
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output);
for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "scene.js",
  "planner.js",
  "geometry.js",
  "asset-import.js",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
])
  fs.copyFileSync(file, path.join(output, file));
for (const folder of ["vendor", "fixtures"])
  fs.cpSync(folder, path.join(output, folder), { recursive: true });
console.log(
  "Built static local-runtime app with bundled Three.js, MIT notices, and original test asset in dist/. No Aholo account or API calls were made.",
);
