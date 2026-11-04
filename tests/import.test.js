import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { importGLTF, geometryMatches } from "../asset-import.js";
const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/original-sample.gltf", import.meta.url),
    "utf8",
  ),
);
const encoded = (doc) => new TextEncoder().encode(JSON.stringify(doc));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} ≈ ${b}`);
function makeGLB(doc) {
  const d = structuredClone(doc),
    binary = Buffer.from(d.buffers[0].uri.split(",")[1], "base64");
  delete d.buffers[0].uri;
  const rawJSON = Buffer.from(JSON.stringify(d)),
    json = Buffer.concat([
      rawJSON,
      Buffer.alloc((4 - (rawJSON.length % 4)) % 4, 32),
    ]),
    bin = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const out = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20);
  const start = 20 + json.length;
  out.writeUInt32LE(bin.length, start);
  out.writeUInt32LE(0x004e4942, start + 4);
  bin.copy(out, start + 8);
  return out;
}

test("original embedded glTF and GLB produce the same grounded metric geometry", () => {
  const a = importGLTF(encoded(fixture), "original.gltf"),
    b = importGLTF(makeGLB(fixture), "original.glb");
  near(a.dimensions.width, 1.3);
  near(a.dimensions.depth, 0.8);
  near(a.dimensions.height, 0.9);
  assert.equal(a.vertexCount, 8);
  assert.equal(a.triangleCount, 12);
  assert.deepEqual(a.parts, b.parts);
  assert.equal(
    Math.min(...a.parts[0].positions.filter((_, i) => i % 3 === 1)),
    0,
  );
});
test("node hierarchy, scaling, rotation and declared coordinate units affect real geometry", () => {
  const d = structuredClone(fixture);
  d.nodes = [
    {
      translation: [4, 0, 2],
      children: [1],
      rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    },
    { mesh: 0, scale: [2, 1, 1] },
  ];
  const a = importGLTF(encoded(d), "child.gltf");
  near(a.dimensions.width, 0.8);
  near(a.dimensions.depth, 2.6);
  const cm = importGLTF(encoded(d), "centimetres.gltf", 0.01);
  near(cm.dimensions.depth, 0.026);
  assert.throws(() => importGLTF(encoded(d), "wrong-unit.gltf", 2));
});
test("interleaved FLOAT positions obey byteStride instead of reading padding", () => {
  const d = structuredClone(fixture),
    source = Buffer.from(d.buffers[0].uri.split(",")[1], "base64"),
    data = Buffer.alloc(128 + 72);
  for (let i = 0; i < 8; i++) {
    source.copy(data, i * 16, i * 12, i * 12 + 12);
    data.writeFloatLE(999, i * 16 + 12);
  }
  source.copy(data, 128, 96);
  d.buffers[0] = {
    byteLength: data.length,
    uri: "data:application/octet-stream;base64," + data.toString("base64"),
  };
  d.bufferViews[0].byteLength = 128;
  d.bufferViews[0].byteStride = 16;
  d.bufferViews[1].byteOffset = 128;
  const a = importGLTF(encoded(d));
  near(a.dimensions.width, 1.3);
  near(a.dimensions.height, 0.9);
});
test("external buffers and required compression are rejected without resolving a URI", () => {
  const a = structuredClone(fixture);
  a.buffers[0].uri = "https://example.invalid/model.bin";
  assert.throws(() => importGLTF(encoded(a)), /外部|base64/);
  const b = structuredClone(fixture);
  b.extensionsRequired = ["KHR_draco_mesh_compression"];
  assert.throws(() => importGLTF(encoded(b)), /扩展/);
  const c = structuredClone(fixture);
  c.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: {} };
  assert.throws(() => importGLTF(encoded(c)), /无压缩/);
});
test("textures and animation are reported as ignored, never loaded or silently rendered", () => {
  const d = structuredClone(fixture);
  d.images = [{ uri: "https://example.invalid/texture.png" }];
  d.textures = [{ source: 0 }];
  d.animations = [{}];
  const a = importGLTF(encoded(d));
  assert.equal(a.warnings.length, 2);
  assert.ok(a.warnings.some((warning) => /不会请求/.test(warning)));
});
test("cycles, out-of-range indices, sparse accessors, unsupported skins and truncation are rejected", () => {
  const cycle = structuredClone(fixture);
  cycle.nodes[0].children = [0];
  assert.throws(() => importGLTF(encoded(cycle)), /循环/);
  const index = structuredClone(fixture),
    data = Buffer.from(index.buffers[0].uri.split(",")[1], "base64");
  data.writeUInt16LE(999, 96);
  index.buffers[0].uri =
    "data:application/octet-stream;base64," + data.toString("base64");
  assert.throws(() => importGLTF(encoded(index)), /索引/);
  const sparse = structuredClone(fixture);
  sparse.accessors[0].sparse = {};
  assert.throws(() => importGLTF(encoded(sparse)), /sparse/);
  const skin = structuredClone(fixture);
  skin.skins = [{}];
  assert.throws(() => importGLTF(encoded(skin)), /蒙皮/);
  const glb = makeGLB(fixture);
  assert.throws(() => importGLTF(glb.subarray(0, glb.length - 1)), /长度/);
});
test("malformed position bytes and non-finite geometry cannot become plausible dimensions", () => {
  const d = structuredClone(fixture);
  d.accessors[0].count = 100;
  assert.throws(() => importGLTF(encoded(d)), /边界/);
  const n = structuredClone(fixture),
    buffer = Buffer.from(n.buffers[0].uri.split(",")[1], "base64");
  buffer.writeFloatLE(NaN, 0);
  n.buffers[0].uri =
    "data:application/octet-stream;base64," + buffer.toString("base64");
  assert.throws(() => importGLTF(encoded(n)), /有限/);
  assert.throws(() => importGLTF(new Uint8Array([1, 2, 3])), /解析/);
});

test("rehydrated preview rejects mismatched restored proxy dimensions", () => {
  const imported = importGLTF(encoded(fixture));
  assert.equal(
    geometryMatches({ dimensions: { ...imported.dimensions } }, imported),
    true,
  );
  assert.equal(
    geometryMatches(
      { dimensions: { ...imported.dimensions, width: 12 } },
      imported,
    ),
    false,
  );
  assert.equal(
    geometryMatches({ dimensions: imported.dimensions }, undefined),
    false,
  );
});
