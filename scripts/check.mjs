import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const own = [
  "app.js",
  "scene.js",
  "planner.js",
  "geometry.js",
  "asset-import.js",
  "scripts/serve.mjs",
  "scripts/build.mjs",
];
for (const file of own) {
  const check = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (check.status) process.exit(check.status);
}
for (const file of own.filter((file) => !file.startsWith("scripts/"))) {
  const text = fs.readFileSync(file, "utf8");
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//.test(text))
    throw new Error(`${file}: app code must not request remote content`);
}
const html = fs.readFileSync("index.html", "utf8");
const mapText = html.match(
  /<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/,
)?.[1];
if (
  !mapText ||
  JSON.parse(mapText).imports?.three !== "./vendor/three/three.module.js"
)
  throw new Error("Missing local-only Three.js import map");
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (match[1].startsWith("#") || match[1] === "./") continue;
  if (
    /^(?:https?:)?\/\//.test(match[1]) ||
    !fs.existsSync(path.resolve(match[1]))
  )
    throw new Error(`Missing or external public file: ${match[1]}`);
}
const versions = JSON.parse(
  fs.readFileSync("docs/source-versions.json", "utf8"),
);
for (const file of versions.sources[0].files) {
  const content = fs.readFileSync(path.join("vendor/three", file.name));
  if (crypto.createHash("sha256").update(content).digest("hex") !== file.sha256)
    throw new Error(`Vendored Three.js file changed: ${file.name}`);
}
if (
  !fs.readFileSync("vendor/three/LICENSE", "utf8").includes("The MIT License")
)
  throw new Error("Missing Three.js MIT license");
console.log(
  "Syntax, local assets, no-network application code, local import map, and unchanged Three.js/license checks passed.",
);
