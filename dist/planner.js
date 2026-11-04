import {
  footprint,
  polygonGap,
  roomOverflow,
  zonePolygon,
  EPSILON,
  round,
} from "./geometry.js";

export const BUILTIN_ASSETS = [
  {
    id: "bench",
    name: "弧角长凳",
    kind: "bench",
    color: "#c5966d",
    dimensions: { width: 1.8, depth: 0.6, height: 0.72 },
  },
  {
    id: "seat",
    name: "软垫单椅",
    kind: "seat",
    color: "#8da89c",
    dimensions: { width: 0.72, depth: 0.72, height: 0.96 },
  },
  {
    id: "kiosk",
    name: "斜面展台",
    kind: "kiosk",
    color: "#b9b4a6",
    dimensions: { width: 1.05, depth: 0.7, height: 1.35 },
  },
  {
    id: "plinth",
    name: "圆角陈列台",
    kind: "plinth",
    color: "#e0cda9",
    dimensions: { width: 0.8, depth: 0.8, height: 0.85 },
  },
  {
    id: "plant",
    name: "枝叶装置",
    kind: "plant",
    color: "#718e78",
    dimensions: { width: 0.72, depth: 0.72, height: 1.55 },
  },
].map((asset) => ({
  ...asset,
  source: {
    type: "original-procedural",
    name: "本项目原创程序几何",
    verifiedAholo: false,
  },
  warnings: [],
}));

export const LIMITATIONS = [
  "本工具使用每件资产局部包围盒投影后的定向矩形，可能保守地标出实际空隙。不是精确网格碰撞检测。",
  "只排练水平地面布置；不分析承重、人体可通行性、人体工学、消防或无障碍合规。",
  "间距阈值和留白带由使用者自定，没有法规合格含义。",
  "导入比例与来源声明需人工确认；Aholo Lux3D 实际生成及导出兼容性尚待账号验证。",
];

export function createPlan() {
  return {
    version: 1,
    name: "微型展厅 · 初稿",
    room: { width: 9, depth: 7 },
    clearance: 0.6,
    zone: { enabled: true, width: 1 },
    assets: structuredClone(BUILTIN_ASSETS),
    objects: [
      {
        id: "item-1",
        assetId: "bench",
        name: "入口长凳",
        x: -2.1,
        z: -1,
        yaw: 0,
        scale: 1,
      },
      {
        id: "item-2",
        assetId: "seat",
        name: "试坐单椅",
        x: -1.05,
        z: -1,
        yaw: 0,
        scale: 1,
      },
      {
        id: "item-3",
        assetId: "kiosk",
        name: "作品介绍台",
        x: 2.2,
        z: -0.3,
        yaw: -15,
        scale: 1,
      },
      {
        id: "item-4",
        assetId: "plant",
        name: "枝叶装置",
        x: 0.05,
        z: 1.6,
        yaw: 0,
        scale: 1,
      },
      {
        id: "item-5",
        assetId: "plinth",
        name: "陈列台",
        x: 2.1,
        z: -2.3,
        yaw: 0,
        scale: 1,
      },
    ],
  };
}
const finite = (n, min, max) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
export function validatePlan(plan) {
  if (
    !plan ||
    plan.version !== 1 ||
    typeof plan.name !== "string" ||
    plan.name.length > 100 ||
    !plan.room ||
    !finite(plan.room.width, 2, 30) ||
    !finite(plan.room.depth, 2, 30) ||
    !finite(plan.clearance, 0, 3) ||
    !plan.zone ||
    typeof plan.zone.enabled !== "boolean" ||
    !finite(plan.zone.width, 0.1, plan.room.width) ||
    !Array.isArray(plan.assets) ||
    plan.assets.length > 60 ||
    !Array.isArray(plan.objects) ||
    plan.objects.length > 40
  )
    return false;
  if (
    new Set(plan.assets.map((asset) => asset.id)).size !== plan.assets.length ||
    new Set(plan.objects.map((item) => item.id)).size !== plan.objects.length
  )
    return false;
  if (
    !plan.assets.every(
      (asset) =>
        asset &&
        typeof asset.id === "string" &&
        /^[a-zA-Z0-9_-]{1,80}$/.test(asset.id) &&
        typeof asset.name === "string" &&
        asset.name.length <= 100 &&
        asset.dimensions &&
        ["width", "depth", "height"].every((key) =>
          finite(asset.dimensions[key], 0.001, 100),
        ) &&
        typeof asset.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(asset.color) &&
        asset.source &&
        typeof asset.source.type === "string" &&
        typeof asset.source.name === "string" &&
        typeof asset.source.verifiedAholo === "boolean" &&
        asset.source.verifiedAholo === false &&
        Array.isArray(asset.warnings) &&
        asset.warnings.every(
          (warning) => typeof warning === "string" && warning.length <= 500,
        ),
    )
  )
    return false;
  return plan.objects.every(
    (item) =>
      item &&
      typeof item.id === "string" &&
      /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) &&
      typeof item.name === "string" &&
      item.name.length <= 100 &&
      plan.assets.some((asset) => asset.id === item.assetId) &&
      finite(item.x, -50, 50) &&
      finite(item.z, -50, 50) &&
      finite(item.yaw, -3600, 3600) &&
      finite(item.scale, 0.05, 10),
  );
}

export function analyzePlan(plan) {
  if (!validatePlan(plan))
    throw new Error("方案数据无效，请检查尺寸、资产或摆放参数。");
  const shapes = plan.objects.map((item) => ({
    item,
    asset: plan.assets.find((asset) => asset.id === item.assetId),
    polygon: footprint(
      item,
      plan.assets.find((asset) => asset.id === item.assetId),
    ),
  }));
  const pairs = [],
    issues = [];
  for (let a = 0; a < shapes.length; a++)
    for (let b = a + 1; b < shapes.length; b++) {
      const gap = polygonGap(shapes[a].polygon, shapes[b].polygon);
      const status =
        gap < -EPSILON
          ? "overlap"
          : gap <= EPSILON
            ? "contact"
            : gap + EPSILON < plan.clearance
              ? "clearance"
              : "clear";
      const pair = {
        a: shapes[a].item.id,
        b: shapes[b].item.id,
        aName: shapes[a].item.name,
        bName: shapes[b].item.name,
        gap: round(gap),
        threshold: plan.clearance,
        status,
        method:
          "oriented-rectangle footprint proxy; horizontal shortest edge gap",
      };
      pairs.push(pair);
      if (status !== "clear")
        issues.push({
          id: `pair-${pair.a}-${pair.b}`,
          kind: status,
          objects: [pair.a, pair.b],
          title: `${pair.aName} ↔ ${pair.bName}`,
          detail:
            status === "overlap"
              ? `包围矩形重叠约 ${Math.abs(pair.gap).toFixed(3)} m（最小分离位移代理）。`
              : status === "contact"
                ? "包围矩形接触；没有测得正向间隙。"
                : `最近水平间隙 ${pair.gap.toFixed(3)} m，小于自定 ${plan.clearance.toFixed(2)} m。`,
          gap: pair.gap,
        });
    }
  for (const shape of shapes) {
    const overflow = roomOverflow(shape.polygon, plan.room);
    if (Object.keys(overflow).length)
      issues.push({
        id: `room-${shape.item.id}`,
        kind: "outside",
        objects: [shape.item.id],
        title: `${shape.item.name} 超出房间`,
        detail: `超出侧边：${Object.entries(overflow)
          .map(([side, distance]) => `${side} ${distance}m`)
          .join("；")}。`,
        overflow,
      });
    if (
      plan.zone.enabled &&
      polygonGap(shape.polygon, zonePolygon(plan.zone, plan.room)) < -EPSILON
    )
      issues.push({
        id: `zone-${shape.item.id}`,
        kind: "zone",
        objects: [shape.item.id],
        title: `${shape.item.name} 进入自定留白带`,
        detail: `与中央 ${plan.zone.width.toFixed(2)} m 宽留白区域的包围矩形重叠；这不是通行或消防规范判断。`,
      });
  }
  const count = (kinds) =>
    issues.filter((issue) => kinds.includes(issue.kind)).length;
  return {
    method: "conservative-2d-oriented-bounding-rectangles-v1",
    units: "m",
    pairs,
    issues,
    footprints: shapes.map(({ item, polygon }) => ({
      id: item.id,
      polygon: polygon.map((point) => point.map((value) => round(value, 6))),
    })),
    summary: {
      objects: shapes.length,
      overlaps: count(["overlap", "contact"]),
      narrowGaps: count(["clearance"]),
      outside: count(["outside"]),
      reserved: count(["zone"]),
      total: issues.length,
    },
    limitations: [...LIMITATIONS],
  };
}

export function comparePlans(a, b) {
  const analysisA = analyzePlan(a),
    analysisB = analyzePlan(b);
  const settings = (p) => [
    p.room.width,
    p.room.depth,
    p.clearance,
    p.zone.enabled,
    p.zone.width,
  ];
  const comparableSettings = settings(a).every(
    (value, i) => value === settings(b)[i],
  );
  return {
    a: {
      name: a.name,
      summary: analysisA.summary,
      room: { ...a.room },
      clearance: a.clearance,
      zone: { ...a.zone },
    },
    b: {
      name: b.name,
      summary: analysisB.summary,
      room: { ...b.room },
      clearance: b.clearance,
      zone: { ...b.zone },
    },
    comparableSettings,
    warning: comparableSettings
      ? "两方案使用同一房间、间距阈值与留白带，仅对比几何代理结果，不据此判断安全或设计优劣。"
      : "两方案的房间或检查参数不同，不应直接把问题数量减少解读为改善。",
    delta: Object.fromEntries(
      Object.keys(analysisA.summary).map((key) => [
        key,
        analysisB.summary[key] - analysisA.summary[key],
      ]),
    ),
  };
}

export function makeReport(plan, comparison = null, snapshots = null) {
  return {
    format: "scene-clearance-placement-report-v1",
    createdAt: new Date().toISOString(),
    title: plan.name,
    units: "m",
    declaredAholoIntegrationStatus:
      "pending-account-and-export-verification; no generated-content evidence supplied by this app",
    plan: structuredClone(plan),
    analysis: analyzePlan(plan),
    comparison: comparison ? structuredClone(comparison) : null,
    comparisonPlans: snapshots
      ? {
          a: validatePlan(snapshots.a) ? structuredClone(snapshots.a) : null,
          b: validatePlan(snapshots.b) ? structuredClone(snapshots.b) : null,
        }
      : null,
    limitations: [...LIMITATIONS],
    assetGeometryIncluded: false,
    assetRehydration:
      "Imported model bytes stay in this browser tab. Project JSON preserves footprint dimensions and provenance only; re-import matching original files for mesh preview.",
  };
}
