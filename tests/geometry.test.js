import test from "node:test";
import assert from "node:assert/strict";
import {
  footprint,
  polygonGap,
  pointSegmentDistance,
  roomOverflow,
} from "../geometry.js";
import {
  createPlan,
  validatePlan,
  analyzePlan,
  comparePlans,
  makeReport,
} from "../planner.js";
const asset = { dimensions: { width: 1, depth: 1, height: 1 } };
const shape = (x, z, yaw = 0, scale = 1) =>
  footprint({ x, z, yaw, scale }, asset);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test("footprint gap distinguishes overlap, zero contact, positive gap and containment", () => {
  near(polygonGap(shape(0, 0), shape(0.5, 0)), -0.5);
  near(polygonGap(shape(0, 0), shape(1, 0)), 0);
  near(polygonGap(shape(0, 0), shape(2, 0)), 1);
  near(polygonGap(shape(0, 0, 0, 4), shape(0, 0)), -2.5);
});
test("rotated rectangles use oriented bounds rather than axis-aligned overlap", () => {
  near(polygonGap(shape(0, 0), shape(3, 0, 45)), 3 - 0.5 - Math.SQRT1_2);
  const a = footprint(
    { x: 0, z: 0, yaw: 45, scale: 1 },
    { dimensions: { width: 3, depth: 0.2 } },
  );
  const b = footprint(
    { x: 0, z: 0.6, yaw: 45, scale: 1 },
    { dimensions: { width: 3, depth: 0.2 } },
  );
  assert.ok(polygonGap(a, b) > 0.2);
});
test("distance handles corners and degenerate edges; room overflow explains each side", () => {
  near(pointSegmentDistance([2, 2], [0, 0], [1, 0]), Math.sqrt(5));
  near(pointSegmentDistance([1, 1], [0, 0], [0, 0]), Math.sqrt(2));
  assert.deepEqual(roomOverflow(shape(4.5, 0), { width: 9, depth: 7 }), {
    east: 0.5,
  });
});
test("original scene has real, actionable overlap and reserved-zone findings", () => {
  const p = createPlan(),
    before = JSON.stringify(p),
    a = analyzePlan(p);
  assert.ok(a.summary.overlaps > 0);
  assert.ok(a.summary.reserved > 0);
  assert.equal(a.pairs.length, (p.objects.length * (p.objects.length - 1)) / 2);
  assert.equal(JSON.stringify(p), before);
  const corrected = structuredClone(p);
  corrected.objects.find((o) => o.id === "item-2").z = 1.5;
  corrected.objects.find((o) => o.id === "item-4").x = -3.5;
  const next = analyzePlan(corrected);
  assert.ok(next.summary.overlaps < a.summary.overlaps);
  assert.equal(next.summary.reserved, 0);
});
test("threshold equality is not a narrow gap, while zero contact stays explicit", () => {
  const p = createPlan();
  p.objects = [
    {
      id: "one",
      assetId: "plinth",
      name: "one",
      x: -2,
      z: 0,
      yaw: 0,
      scale: 1,
    },
    {
      id: "two",
      assetId: "plinth",
      name: "two",
      x: -0.6,
      z: 0,
      yaw: 0,
      scale: 1,
    },
  ];
  p.zone.enabled = false;
  near(analyzePlan(p).pairs[0].gap, 0.6);
  assert.equal(analyzePlan(p).pairs[0].status, "clear");
  p.objects[1].x = -1.2;
  p.clearance = 0;
  assert.equal(analyzePlan(p).pairs[0].status, "contact");
});
test("comparison warns on parameter changes and ignores JSON object property ordering", () => {
  const a = createPlan(),
    b = structuredClone(a);
  b.room = { depth: 7, width: 9 };
  assert.equal(comparePlans(a, b).comparableSettings, true);
  b.clearance = 0;
  const result = comparePlans(a, b);
  assert.equal(result.comparableSettings, false);
  assert.match(result.warning, /不同/);
  assert.equal(result.b.clearance, 0);
});
test("plan validation rejects non-finite positions, forged verified provenance and bad references", () => {
  const p = createPlan();
  assert.equal(validatePlan(p), true);
  const a = structuredClone(p);
  a.objects[0].x = Infinity;
  assert.equal(validatePlan(a), false);
  a.objects[0].x = 0;
  a.assets[0].source.verifiedAholo = true;
  assert.equal(validatePlan(a), false);
  a.assets[0].source.verifiedAholo = false;
  a.objects[0].assetId = "missing";
  assert.equal(validatePlan(a), false);
  assert.throws(() => analyzePlan(a));
});
test("reviewable report includes all pairs, unchanged plan, snapshots and provenance boundary", () => {
  const p = createPlan(),
    report = makeReport(p, comparePlans(p, p), { a: p, b: p });
  assert.equal(report.assetGeometryIncluded, false);
  assert.ok(report.analysis.pairs.length);
  assert.match(report.declaredAholoIntegrationStatus, /does not authenticate/);
  assert.ok(report.plan.assets.every((asset) => asset.source.verifiedAholo === false));
  assert.equal(validatePlan(report.comparisonPlans.a), true);
  report.plan.objects[0].x = 99;
  assert.notEqual(p.objects[0].x, 99);
  report.comparisonPlans.a.name = "changed";
  assert.notEqual(p.name, "changed");
});
