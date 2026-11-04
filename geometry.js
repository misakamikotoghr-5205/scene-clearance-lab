/** All measurements are metres. Footprints are conservative oriented rectangles. */
export const EPSILON = 1e-7;
export const round = (value, digits = 3) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

export function footprint(item, asset) {
  const angle = (item.yaw * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const width = (asset.dimensions.width * item.scale) / 2,
    depth = (asset.dimensions.depth * item.scale) / 2;
  return [
    [-width, -depth],
    [width, -depth],
    [width, depth],
    [-width, depth],
  ].map(([x, z]) => [item.x + x * c - z * s, item.z + x * s + z * c]);
}

function projection(points, axis) {
  const values = points.map(([x, z]) => x * axis[0] + z * axis[1]);
  return [Math.min(...values), Math.max(...values)];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}
export function pointSegmentDistance(point, start, end) {
  const v = [end[0] - start[0], end[1] - start[1]],
    w = [point[0] - start[0], point[1] - start[1]];
  const denominator = dot(v, v),
    t = denominator ? Math.max(0, Math.min(1, dot(w, v) / denominator)) : 0;
  return Math.hypot(
    point[0] - start[0] - t * v[0],
    point[1] - start[1] - t * v[1],
  );
}

/** Negative = proxy penetration, zero = contact, positive = shortest 2D edge gap. */
export function polygonGap(a, b) {
  let separated = false,
    minimumOverlap = Infinity;
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length],
        length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!length) continue;
      const axis = [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
      const pa = projection(a, axis),
        pb = projection(b, axis);
      const overlap = Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]);
      if (overlap < -EPSILON) separated = true;
      // Containment needs the nearest separating translation, not only intersection length.
      minimumOverlap = Math.min(
        minimumOverlap,
        Math.min(pa[1] - pb[0], pb[1] - pa[0]),
      );
    }
  if (!separated) return minimumOverlap > EPSILON ? -minimumOverlap : 0;
  let gap = Infinity;
  for (const [points, edges] of [
    [a, b],
    [b, a],
  ])
    for (const point of points)
      for (let i = 0; i < edges.length; i++)
        gap = Math.min(
          gap,
          pointSegmentDistance(point, edges[i], edges[(i + 1) % edges.length]),
        );
  return gap;
}

export function roomOverflow(points, room) {
  const halfWidth = room.width / 2,
    halfDepth = room.depth / 2;
  const excess = {
    west: Math.max(0, -halfWidth - Math.min(...points.map((p) => p[0]))),
    east: Math.max(0, Math.max(...points.map((p) => p[0])) - halfWidth),
    north: Math.max(0, -halfDepth - Math.min(...points.map((p) => p[1]))),
    south: Math.max(0, Math.max(...points.map((p) => p[1])) - halfDepth),
  };
  return Object.fromEntries(
    Object.entries(excess)
      .filter(([, value]) => value > EPSILON)
      .map(([key, value]) => [key, round(value)]),
  );
}

export function zonePolygon(zone, room) {
  return [
    [-zone.width / 2, -room.depth / 2],
    [zone.width / 2, -room.depth / 2],
    [zone.width / 2, room.depth / 2],
    [-zone.width / 2, room.depth / 2],
  ];
}
