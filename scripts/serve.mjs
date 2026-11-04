import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.existsSync(path.join(source, "dist/index.html"))
  ? path.join(source, "dist")
  : source;
const port = Number(process.env.PORT || 4187);
const types = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".md": "text/markdown;charset=utf-8",
};
http
  .createServer((req, res) => {
    let name;
    try {
      name = decodeURIComponent(new URL(req.url, "http://local").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = path.resolve(
      root,
      `.${name.endsWith("/") ? name + "index.html" : name}`,
    );
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "text/plain;charset=utf-8",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Scene Clearance Lab: http://127.0.0.1:${port}`),
  );
