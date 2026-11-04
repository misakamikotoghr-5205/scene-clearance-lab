import * as THREE from "./vendor/three/three.module.js";
import { OrbitControls } from "./vendor/three/OrbitControls.js";
import { footprint } from "./geometry.js";
import { geometryMatches } from "./asset-import.js";

export class PlacementView {
  constructor(container, { onSelect, onMove, onCommit, onUnavailable }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onMove = onMove;
    this.onCommit = onCommit;
    this.showBounds = true;
    this.mode = "orbit";
    this.prototypes = new Map();
    this.runtime = new Map();
    this.drag = null;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#e9ece7");
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.camera.position.set(10, 9.5, 11);
    this.models = new THREE.Group();
    this.helpers = new THREE.Group();
    this.floor = new THREE.Group();
    this.scene.add(this.models, this.helpers, this.floor);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x839079, 2.3));
    const light = new THREE.DirectionalLight(0xfff7e7, 3.5);
    light.position.set(-4, 9, 6);
    this.scene.add(light);
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
      });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.18;
      this.canvas = this.renderer.domElement;
      container.append(this.canvas);
      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.target.set(0, 0.2, 0);
      this.controls.minDistance = 3;
      this.controls.maxDistance = 32;
      this.controls.maxPolarAngle = Math.PI / 2.04;
      this.controls.enableDamping = false;
      this.controls.addEventListener("change", () => this.draw());
      this.controls.update();
    } catch {
      this.renderer = null;
      this.canvas = document.createElement("canvas");
      container.append(this.canvas);
      onUnavailable(
        "当前环境未启用WebGL2，已使用可操作的俯视几何图；数值摆放与全部检查仍然可用。",
      );
    }
    this.canvas.setAttribute(
      "aria-label",
      "布置预览：观察模式拖动旋转；移动模式可拖动选中的物件。也可使用右侧数值与方向按钮。",
    );
    this.canvas.tabIndex = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.canvas.addEventListener("pointerdown", (event) =>
      this.pointerDown(event),
    );
    this.canvas.addEventListener("pointermove", (event) =>
      this.pointerMove(event),
    );
    this.canvas.addEventListener("pointerup", () => this.pointerUp());
    this.canvas.addEventListener("pointercancel", () => this.pointerUp());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }
  material(color) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      metalness: 0.02,
    });
  }
  prototype(asset, runtime) {
    const existing = this.prototypes.get(asset.id);
    if (existing && existing.runtime === runtime) return existing.group;
    if (existing)
      existing.group.traverse((child) => {
        child.geometry?.dispose();
        child.material?.dispose();
      });
    const group = new THREE.Group(),
      material = this.material(asset.color);
    const mesh = (geometry, x, y, z, color = material) => {
      const object = new THREE.Mesh(geometry, color);
      object.position.set(x, y, z);
      group.add(object);
      return object;
    };
    const box = (w, h, d, x, y, z, color = material) =>
      mesh(new THREE.BoxGeometry(w, h, d), x, y, z, color);
    const { width: w, depth: d, height: h } = asset.dimensions;
    if (runtime)
      for (const part of runtime.parts) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(part.positions, 3),
        );
        geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
        geometry.computeVertexNormals();
        const color = new THREE.Color().setRGB(
            ...part.color,
            THREE.LinearSRGBColorSpace,
          ),
          mat = this.material(color);
        mat.side = THREE.DoubleSide;
        mesh(geometry, 0, 0, 0, mat);
      }
    else if (asset.source.type !== "original-procedural") {
      const proxy = box(w, h, d, 0, h / 2, 0);
      proxy.material = new THREE.MeshStandardMaterial({
        color: asset.color,
        transparent: true,
        opacity: 0.4,
        roughness: 1,
      });
    } else if (asset.kind === "bench") {
      box(w, 0.13, d, 0, 0.48, 0);
      box(w, 0.18, 0.07, 0, 0.63, -0.255);
      for (const x of [-w / 2 + 0.15, w / 2 - 0.15])
        for (const z of [-0.19, 0.19])
          box(0.09, 0.415, 0.09, x, 0.2075, z, this.material("#77756d"));
    } else if (asset.kind === "seat") {
      box(w, 0.13, d, 0, 0.45, 0);
      box(w, 0.44, 0.1, 0, 0.74, -0.31);
      for (const x of [-0.25, 0.25])
        for (const z of [-0.25, 0.25])
          box(0.07, 0.385, 0.07, x, 0.1925, z, this.material("#807568"));
    } else if (asset.kind === "kiosk") {
      box(w * 0.86, h - 0.12, d * 0.86, 0, (h - 0.12) / 2, 0);
      box(w, 0.12, d, 0, h - 0.06, 0, this.material("#788c84"));
      box(0.6, 0.015, 0.3, 0, h - 0.015, 0, this.material("#475e57"));
    } else if (asset.kind === "plinth")
      mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 40), 0, h / 2, 0);
    else if (asset.kind === "plant") {
      mesh(
        new THREE.CylinderGeometry(0.25, 0.19, 0.4, 24),
        0,
        0.2,
        0,
        this.material("#b89b7d"),
      );
      mesh(
        new THREE.CylinderGeometry(0.025, 0.035, 0.9, 10),
        0,
        0.8,
        0,
        this.material("#7e8065"),
      );
      for (const [x, y, z, r] of [
        [0, 1.25, 0, 0.3],
        [-0.15, 1.05, 0, 0.2],
        [0.12, 1.1, 0.14, 0.18],
      ])
        mesh(new THREE.SphereGeometry(r, 16, 12), x, y, z);
    } else box(w, h, d, 0, h / 2, 0);
    this.prototypes.set(asset.id, { runtime, group });
    return group;
  }
  clearHelpers() {
    this.helpers.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.helpers.clear();
  }
  update(plan, analysis, selected, runtime = this.runtime) {
    this.plan = plan;
    this.analysis = analysis;
    this.selected = selected;
    this.runtime = runtime;
    this.models.clear();
    this.clearHelpers();
    const roomKey = `${plan.room.width}/${plan.room.depth}/${plan.zone.enabled}/${plan.zone.width}`;
    if (roomKey !== this.roomKey) {
      this.floor.traverse((child) => {
        child.geometry?.dispose();
        child.material?.dispose();
      });
      this.floor.clear();
      this.roomKey = roomKey;
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(plan.room.width, 0.09, plan.room.depth),
        this.material("#f3f0e6"),
      );
      floor.position.y = -0.055;
      this.floor.add(floor);
      const grid = new THREE.GridHelper(30, 60, 0x879b87, 0xbfc8ba);
      grid.position.y = 0.002;
      grid.material.transparent = true;
      grid.material.opacity = 0.2;
      this.floor.add(grid);
      const wallMat = this.material("#d2d8cd");
      for (const [w, d, x, z] of [
        [plan.room.width, 0.07, 0, -plan.room.depth / 2],
        [0.07, plan.room.depth, -plan.room.width / 2, 0],
      ]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, d), wallMat);
        wall.position.set(x, 0.225, z);
        this.floor.add(wall);
      }
      if (plan.zone.enabled) {
        const zone = new THREE.Mesh(
          new THREE.PlaneGeometry(plan.zone.width, plan.room.depth),
          new THREE.MeshBasicMaterial({
            color: "#93b8b2",
            transparent: true,
            opacity: 0.21,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        zone.rotation.x = -Math.PI / 2;
        zone.position.y = 0.008;
        this.floor.add(zone);
      }
    }
    for (const item of plan.objects) {
      const asset = plan.assets.find((a) => a.id === item.assetId),
        model = this.prototype(
          asset,
          geometryMatches(asset, runtime.get(asset.id))
            ? runtime.get(asset.id)
            : undefined,
        ).clone(true);
      model.position.set(item.x, 0, item.z);
      model.rotation.y = (-item.yaw * Math.PI) / 180;
      model.scale.setScalar(item.scale);
      model.userData.objectId = item.id;
      this.models.add(model);
      if (this.showBounds || item.id === selected) {
        const kinds = analysis.issues
          .filter((issue) => issue.objects.includes(item.id))
          .map((issue) => issue.kind);
        const color = kinds.some((kind) =>
          ["overlap", "contact", "outside"].includes(kind),
        )
          ? "#bd7059"
          : kinds.length
            ? "#b69a4b"
            : item.id === selected
              ? "#467b6b"
              : "#91a18e";
        const geometry = new THREE.EdgesGeometry(
          new THREE.BoxGeometry(
            asset.dimensions.width * item.scale,
            asset.dimensions.height * item.scale,
            asset.dimensions.depth * item.scale,
          ),
        );
        const wire = new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: item.id === selected ? 0.95 : 0.55,
          }),
        );
        wire.rotation.y = (-item.yaw * Math.PI) / 180;
        wire.position.set(
          item.x,
          (asset.dimensions.height * item.scale) / 2,
          item.z,
        );
        this.helpers.add(wire);
      }
    }
    this.draw();
  }
  resize() {
    const width = this.container.clientWidth || 600,
      height = this.container.clientHeight || 480;
    this.width = width;
    this.height = height;
    if (this.renderer) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    } else {
      this.canvas.width = width * (devicePixelRatio || 1);
      this.canvas.height = height * (devicePixelRatio || 1);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.draw();
  }
  draw() {
    if (!this.plan) return;
    if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const ctx = this.canvas.getContext("2d"),
      ratio = devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#e9ece7";
    ctx.fillRect(0, 0, this.width, this.height);
    const scale = Math.min(
      (this.width - 70) / this.plan.room.width,
      (this.height - 60) / this.plan.room.depth,
    );
    this.fallbackScale = scale;
    ctx.translate(this.width / 2, this.height / 2);
    ctx.fillStyle = "#f8f4e9";
    ctx.fillRect(
      (-this.plan.room.width / 2) * scale,
      (-this.plan.room.depth / 2) * scale,
      this.plan.room.width * scale,
      this.plan.room.depth * scale,
    );
    if (this.plan.zone.enabled) {
      ctx.fillStyle = "#c3d7cf";
      ctx.fillRect(
        (-this.plan.zone.width / 2) * scale,
        (-this.plan.room.depth / 2) * scale,
        this.plan.zone.width * scale,
        this.plan.room.depth * scale,
      );
    }
    for (const item of this.plan.objects) {
      const asset = this.plan.assets.find((a) => a.id === item.assetId),
        points = footprint(item, asset);
      ctx.beginPath();
      points.forEach(([x, z], i) =>
        i ? ctx.lineTo(x * scale, z * scale) : ctx.moveTo(x * scale, z * scale),
      );
      ctx.closePath();
      ctx.fillStyle = asset.color;
      ctx.fill();
      ctx.strokeStyle = item.id === this.selected ? "#2e675b" : "#7d887a";
      ctx.lineWidth = item.id === this.selected ? 3 : 1;
      ctx.stroke();
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  setView(view) {
    if (!this.renderer) return;
    this.camera.position.set(
      ...(view === "top" ? [0.001, 18, 0.001] : [10, 9.5, 11]),
    );
    this.controls.target.set(0, 0.2, 0);
    this.controls.update();
    this.draw();
  }
  ray(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  floorPoint(event) {
    if (!this.renderer) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left - this.width / 2) / this.fallbackScale,
        z: (event.clientY - rect.top - this.height / 2) / this.fallbackScale,
      };
    }
    this.ray(event);
    const point = this.raycaster.ray.intersectPlane(
      this.plane,
      new THREE.Vector3(),
    );
    return point && { x: point.x, z: point.z };
  }
  pointerDown(event) {
    if (!this.plan) return;
    let id;
    if (this.renderer) {
      this.ray(event);
      const hit = this.raycaster
        .intersectObjects(this.models.children, true)
        .find((entry) => entry.object.isMesh);
      let object = hit?.object;
      while (object && !object.userData.objectId) object = object.parent;
      id = object?.userData.objectId;
    } else {
      const point = this.floorPoint(event);
      id = [...this.plan.objects].reverse().find((item) => {
        const p = footprint(
          item,
          this.plan.assets.find((a) => a.id === item.assetId),
        );
        let sign = null;
        for (let i = 0; i < 4; i++) {
          const a = p[i],
            b = p[(i + 1) % 4],
            cross =
              (b[0] - a[0]) * (point.z - a[1]) -
              (b[1] - a[1]) * (point.x - a[0]);
          if (Math.abs(cross) > 1e-7) {
            if (sign !== null && sign !== Math.sign(cross)) return false;
            sign = Math.sign(cross);
          }
        }
        return true;
      })?.id;
    }
    if (!id) return;
    this.onSelect(id);
    if (this.mode === "move") {
      const item = this.plan.objects.find((o) => o.id === id),
        point = this.floorPoint(event);
      if (!point) return;
      this.drag = { id, dx: item.x - point.x, dz: item.z - point.z };
      if (this.controls) this.controls.enabled = false;
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  }
  pointerMove(event) {
    if (!this.drag) return;
    const point = this.floorPoint(event);
    if (!point) return;
    const snap = (n) => Math.round(Math.max(-50, Math.min(50, n)) * 10) / 10;
    this.onMove(
      this.drag.id,
      snap(point.x + this.drag.dx),
      snap(point.z + this.drag.dz),
    );
  }
  pointerUp() {
    if (!this.drag) return;
    this.drag = null;
    if (this.controls) this.controls.enabled = true;
    this.onCommit();
  }
}
