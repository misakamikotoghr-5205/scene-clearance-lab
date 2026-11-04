/** Restricted local glTF 2.0 reader. It deliberately never resolves a URI or executes content. */
export const IMPORT_LIMITS = {
  fileBytes: 12 * 1024 * 1024,
  decodedBytes: 20 * 1024 * 1024,
  vertices: 200000,
  triangles: 400000,
  primitives: 80,
  nodes: 400,
};
const fail = (message) => {
  throw new Error(message);
};
const finiteArray = (value, length) =>
  Array.isArray(value) &&
  value.length === length &&
  value.every(Number.isFinite);
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const result = Array(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++)
        result[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return result;
}
function nodeMatrix(node) {
  if (node.matrix !== undefined) {
    if (!finiteArray(node.matrix, 16)) fail("节点矩阵必须包含16个有限数值。");
    if (node.translation || node.rotation || node.scale)
      fail("节点不能同时声明matrix与TRS。");
    if (
      Math.abs(node.matrix[3]) +
        Math.abs(node.matrix[7]) +
        Math.abs(node.matrix[11]) >
        1e-7 ||
      Math.abs(node.matrix[15] - 1) > 1e-7
    )
      fail("仅支持仿射节点矩阵。");
    return node.matrix;
  }
  const t = node.translation || [0, 0, 0],
    s = node.scale || [1, 1, 1],
    q = node.rotation || [0, 0, 0, 1];
  if (!finiteArray(t, 3) || !finiteArray(s, 3) || !finiteArray(q, 4))
    fail("节点TRS包含无效数值。");
  const norm = Math.hypot(...q);
  if (Math.abs(norm - 1) > 0.01) fail("节点旋转四元数需要归一化。");
  const [x, y, z, w] = q.map((n) => n / norm),
    x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2,
    yy = y * y2,
    yz = y * z2,
    zz = z * z2,
    wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return [
    (1 - yy - zz) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - xx - zz) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - xx - yy) * s[2],
    0,
    ...t,
    1,
  ];
}
function transformPosition(matrix, x, y, z, scale) {
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * scale,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * scale,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * scale,
  ];
}
function unpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 4 && view.getUint32(0, true) === 0x46546c67) {
    if (
      bytes.byteLength < 20 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.byteLength
    )
      fail("GLB版本或头部长度无效。");
    let offset = 12,
      document = null,
      binary = null,
      chunkIndex = 0;
    while (offset < bytes.byteLength) {
      if (offset + 8 > bytes.byteLength) fail("GLB块头被截断。");
      const length = view.getUint32(offset, true),
        type = view.getUint32(offset + 4, true);
      offset += 8;
      if (length % 4 || offset + length > bytes.byteLength)
        fail("GLB块长度或对齐无效。");
      const chunk = bytes.subarray(offset, offset + length);
      if (chunkIndex === 0 && type !== 0x4e4f534a)
        fail("GLB第一个块必须为JSON。");
      if (type === 0x4e4f534a) {
        if (document) fail("GLB不能有重复JSON块。");
        try {
          document = JSON.parse(
            new TextDecoder().decode(chunk).replace(/[\0\s]+$/, ""),
          );
        } catch {
          fail("GLB JSON无法解析。");
        }
      } else if (type === 0x004e4942) {
        if (binary) fail("仅支持一个GLB BIN块。");
        binary = chunk;
      } else fail("此GLB包含未支持的额外块类型。");
      offset += length;
      chunkIndex++;
    }
    return { document, binary };
  }
  try {
    return {
      document: JSON.parse(new TextDecoder().decode(bytes)),
      binary: null,
    };
  } catch {
    fail("文件不是可解析的glTF JSON或GLB 2.0。");
  }
}
function dataBuffer(uri) {
  if (
    typeof uri !== "string" ||
    !/^data:application\/(?:octet-stream|gltf-buffer);base64,[A-Za-z0-9+/=\r\n]+$/.test(
      uri,
    )
  )
    fail("仅支持GLB内嵌BIN或glTF内嵌base64缓冲。外部/远程.bin不会被请求。");
  const encoded = uri.slice(uri.indexOf(",") + 1);
  if (encoded.length > IMPORT_LIMITS.decodedBytes * 1.4)
    fail("内嵌缓冲超过体积上限。");
  let raw;
  try {
    raw = atob(encoded.replace(/[\r\n]/g, ""));
  } catch {
    fail("base64缓冲无法解码。");
  }
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
function readAccessor(document, buffers, index, position) {
  const accessor = document.accessors?.[index];
  if (!accessor || accessor.sparse || accessor.normalized)
    fail("访问器无效；不支持sparse或normalized属性。");
  const components = position ? 3 : 1,
    type = position ? "VEC3" : "SCALAR";
  if (
    accessor.type !== type ||
    !Number.isInteger(accessor.count) ||
    accessor.count <= 0 ||
    accessor.count > IMPORT_LIMITS.vertices * (position ? 1 : 6)
  )
    fail("访问器类型或元素数量超出支持范围。");
  if (position && accessor.componentType !== 5126)
    fail("POSITION必须是FLOAT32 VEC3；压缩/量化坐标暂不支持。");
  const bytesPer = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[
    accessor.componentType
  ];
  if (!bytesPer || (!position && accessor.componentType === 5126))
    fail("索引仅支持无符号8/16/32位整数。");
  const bufferView = document.bufferViews?.[accessor.bufferView],
    buffer = buffers[bufferView?.buffer];
  if (!bufferView || !buffer || bufferView.extensions?.EXT_meshopt_compression)
    fail("缓冲视图无效或使用未支持的meshopt压缩。");
  const offset = accessor.byteOffset || 0,
    viewOffset = bufferView.byteOffset || 0,
    stride = bufferView.byteStride || components * bytesPer;
  if (
    ![offset, viewOffset, bufferView.byteLength, stride].every(
      (n) => Number.isInteger(n) && n >= 0,
    ) ||
    stride < components * bytesPer ||
    stride > 252 ||
    stride % bytesPer ||
    offset % bytesPer ||
    (viewOffset + offset) % bytesPer
  )
    fail("缓冲偏移、步幅或对齐无效。");
  const end = offset + (accessor.count - 1) * stride + components * bytesPer;
  if (
    end > bufferView.byteLength ||
    viewOffset + bufferView.byteLength > buffer.byteLength
  )
    fail("访问器越过缓冲边界，文件可能被截断。");
  const view = new DataView(
      buffer.buffer,
      buffer.byteOffset + viewOffset,
      bufferView.byteLength,
    ),
    output = position
      ? new Float32Array(accessor.count * components)
      : new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i++)
    for (let c = 0; c < components; c++) {
      const address = offset + i * stride + c * bytesPer;
      const n =
        accessor.componentType === 5126
          ? view.getFloat32(address, true)
          : accessor.componentType === 5125
            ? view.getUint32(address, true)
            : accessor.componentType === 5123
              ? view.getUint16(address, true)
              : view.getUint8(address);
      if (!Number.isFinite(n)) fail("几何坐标包含非有限数值。");
      output[i * components + c] = n;
    }
  return output;
}

export function importGLTF(input, filename = "local-asset.glb", unitScale = 1) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.byteLength || bytes.byteLength > IMPORT_LIMITS.fileBytes)
    fail("请选择不超过12 MiB的本地glTF/GLB文件。");
  if (![1, 0.01, 0.001].includes(unitScale))
    fail("比例选择仅支持米、厘米或毫米。");
  const { document, binary } = unpack(bytes),
    warnings = [];
  if (
    !document ||
    document.asset?.version !== "2.0" ||
    (document.asset.minVersion && document.asset.minVersion !== "2.0")
  )
    fail("仅支持glTF 2.0。");
  if (
    document.extensionsRequired !== undefined &&
    (!Array.isArray(document.extensionsRequired) ||
      !document.extensionsRequired.every((name) => typeof name === "string"))
  )
    fail("必须扩展列表无效。");
  if (
    (document.extensionsRequired || []).some(
      (name) => name !== "KHR_materials_unlit",
    )
  )
    fail("模型依赖未支持的glTF扩展；请导出未压缩静态三角网格。");
  if (document.skins?.length) fail("暂不支持骨骼蒙皮；请先烘焙为静态网格。");
  if (document.animations?.length)
    warnings.push("动画未播放，仅检查默认节点姿态。");
  if (document.images?.length || document.textures?.length)
    warnings.push(
      "纹理图像被忽略且不会请求；预览仅显示baseColorFactor，几何检查不依赖贴图。",
    );
  if (!Array.isArray(document.buffers) || document.buffers.length > 16)
    fail("模型需要有效的内嵌缓冲。");
  const buffers = document.buffers.map((buffer, i) => {
    if (!buffer || typeof buffer !== "object") fail("缓冲声明无效。");
    const value = buffer.uri
      ? dataBuffer(buffer.uri)
      : i === 0 && binary
        ? binary
        : fail("缺少GLB内嵌BIN；外部缓冲不在支持子集中。");
    if (
      !Number.isInteger(buffer.byteLength) ||
      buffer.byteLength <= 0 ||
      buffer.byteLength > value.byteLength
    )
      fail("缓冲声明长度无效。");
    return value;
  });
  if (
    buffers.reduce((n, buffer) => n + buffer.byteLength, 0) >
    IMPORT_LIMITS.decodedBytes
  )
    fail("解码后缓冲总量超过20 MiB。");
  const nodes = document.nodes;
  if (!Array.isArray(nodes) || nodes.length > IMPORT_LIMITS.nodes)
    fail("节点缺失或超过400个。");
  let roots;
  if (document.scenes?.length) {
    const scene = document.scenes[document.scene ?? 0];
    if (!scene || !Array.isArray(scene.nodes)) fail("默认场景无效。");
    roots = scene.nodes;
  } else {
    const children = new Set(nodes.flatMap((node) => node.children || []));
    roots = nodes.map((_, i) => i).filter((i) => !children.has(i));
  }
  const parts = [],
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0,
    triangles = 0;
  function traverse(index, parentMatrix, chain) {
    if (!Number.isInteger(index) || !nodes[index] || chain.has(index))
      fail("节点引用无效或存在循环。");
    const node = nodes[index];
    if (node.skin !== undefined || node.weights)
      fail("蒙皮和形变权重暂不支持。");
    const matrix = multiply(parentMatrix, nodeMatrix(node)),
      next = new Set(chain);
    next.add(index);
    if (node.mesh !== undefined) {
      const mesh = document.meshes?.[node.mesh];
      if (!mesh || !Array.isArray(mesh.primitives)) fail("网格引用无效。");
      for (const primitive of mesh.primitives) {
        if (!primitive || typeof primitive !== "object") fail("网格图元无效。");
        if (
          (primitive.mode ?? 4) !== 4 ||
          primitive.targets ||
          primitive.extensions?.KHR_draco_mesh_compression
        )
          fail("仅支持无压缩、无形变目标的TRIANGLES网格。");
        if (parts.length >= IMPORT_LIMITS.primitives)
          fail("网格图元超过80个。");
        const positions = readAccessor(
            document,
            buffers,
            primitive.attributes?.POSITION,
            true,
          ),
          count = positions.length / 3;
        vertices += count;
        if (vertices > IMPORT_LIMITS.vertices)
          fail("展开后的顶点超过200,000个。");
        const indices =
          primitive.indices === undefined
            ? Uint32Array.from({ length: count }, (_, i) => i)
            : readAccessor(document, buffers, primitive.indices, false);
        if (indices.length % 3 || indices.some((value) => value >= count))
          fail("三角索引数量或顶点引用无效。");
        triangles += indices.length / 3;
        if (triangles > IMPORT_LIMITS.triangles)
          fail("三角形总数超过400,000个。");
        for (let i = 0; i < count; i++) {
          const transformed = transformPosition(
            matrix,
            ...positions.subarray(i * 3, i * 3 + 3),
            unitScale,
          );
          for (let axis = 0; axis < 3; axis++) {
            if (
              !Number.isFinite(transformed[axis]) ||
              Math.abs(transformed[axis]) > 1e5
            )
              fail("变换后坐标不合理，请确认单位与导出矩阵。");
            positions[i * 3 + axis] = transformed[axis];
            min[axis] = Math.min(min[axis], transformed[axis]);
            max[axis] = Math.max(max[axis], transformed[axis]);
          }
        }
        const material = document.materials?.[primitive.material],
          color = material?.pbrMetallicRoughness?.baseColorFactor || [
            0.56, 0.68, 0.65, 1,
          ];
        if (!finiteArray(color, 4) || color.some((n) => n < 0 || n > 1))
          fail("材质baseColorFactor需要0–1之间的RGBA。");
        if (
          color[3] < 1 &&
          !warnings.includes("透明度未应用；几何以不透明基础色预览。")
        )
          warnings.push("透明度未应用；几何以不透明基础色预览。");
        parts.push({ positions, indices, color: color.slice(0, 3) });
      }
    }
    if (node.children !== undefined && !Array.isArray(node.children))
      fail("节点children应为索引数组。");
    for (const child of node.children || []) traverse(child, matrix, next);
  }
  for (const root of roots) traverse(root, identity(), new Set());
  if (!parts.length) fail("默认场景没有可显示的静态三角网格。");
  const offset = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2],
    sizes = max.map((value, i) => value - min[i]);
  if (sizes.some((value) => value > 100))
    fail("模型某个方向超过100m，请核对单位后重试。");
  if (sizes.some((value) => value < 0.001))
    warnings.push("极薄方向按1mm包围代理处理；结果仅用于平面布置排练。");
  for (const part of parts)
    for (let i = 0; i < part.positions.length; i++)
      part.positions[i] -= offset[i % 3];
  return {
    name: String(filename)
      .replace(/\.[^.]+$/, "")
      .slice(0, 80),
    dimensions: {
      width: Math.max(0.001, sizes[0]),
      height: Math.max(0.001, sizes[1]),
      depth: Math.max(0.001, sizes[2]),
    },
    parts,
    vertexCount: vertices,
    triangleCount: parts.reduce((n, part) => n + part.indices.length / 3, 0),
    warnings,
    originalBounds: { min, max },
    normalizedOrigin: "horizontal centre; bottom on y=0",
    unitScale,
  };
}

/** Restored metadata must match freshly read geometry before it may replace a proxy. */
export function geometryMatches(asset, imported) {
  return (
    !!imported &&
    ["width", "height", "depth"].every(
      (key) =>
        Math.abs(asset.dimensions[key] - imported.dimensions[key]) <=
        Math.max(1e-6, imported.dimensions[key] * 1e-6),
    )
  );
}
