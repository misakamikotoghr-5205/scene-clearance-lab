import { PlacementView } from "./scene.js";
import {
  createPlan,
  validatePlan,
  analyzePlan,
  comparePlans,
  makeReport,
  LIMITATIONS,
} from "./planner.js";
import { importGLTF, IMPORT_LIMITS, geometryMatches } from "./asset-import.js";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const clone = (value) => structuredClone(value);
const key = "scene-clearance-lab:project:v1";
const symbols = {
  bench: "▰",
  seat: "♧",
  kiosk: "▱",
  plinth: "◒",
  plant: "♧",
  imported: "◇",
};
let plan = createPlan(),
  snapshots = { a: null, b: null },
  selected = plan.objects[0].id,
  analysis;
const runtime = new Map(),
  undoStack = [],
  redoStack = [];
let pendingDrag = null,
  storageWarning = false;
try {
  const saved = JSON.parse(localStorage.getItem(key));
  if (saved && validatePlan(saved.plan)) {
    plan = saved.plan;
    selected = plan.objects[0]?.id || null;
    for (const slot of ["a", "b"])
      if (validatePlan(saved.snapshots?.[slot]))
        snapshots[slot] = saved.snapshots[slot];
  }
} catch {}

function notice(message = "", error = false) {
  $("#live-status").textContent = message;
  $("#live-status").classList.toggle("error", error);
}
function save() {
  try {
    localStorage.setItem(key, JSON.stringify({ plan, snapshots }));
  } catch {
    if (!storageWarning) {
      notice("此浏览器暂时不能保存。当前排练仍可继续；离开前请保存方案JSON。");
      storageWarning = true;
    }
  }
}
function remember(before) {
  undoStack.push(before);
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
}
function mutate(operation) {
  const before = clone(plan);
  try {
    operation(plan);
    if (!validatePlan(plan))
      throw new Error("参数超出支持范围，当前操作已撤回。");
    remember(before);
    render();
    save();
  } catch (error) {
    plan = before;
    render();
    notice(error.message, true);
  }
}
function uniqueId(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const view = new PlacementView($("#viewport"), {
  onSelect(id) {
    selected = id;
    render();
  },
  onMove(id, x, z) {
    const item = plan.objects.find((candidate) => candidate.id === id);
    if (!item) return;
    if (!pendingDrag) pendingDrag = clone(plan);
    item.x = x;
    item.z = z;
    render();
  },
  onCommit() {
    if (pendingDrag) {
      remember(pendingDrag);
      pendingDrag = null;
      save();
      render();
    }
  },
  onUnavailable(message) {
    notice(message);
  },
});

function renderLibrary() {
  $("#asset-count").textContent = `${plan.assets.length} ASSETS`;
  $("#asset-library").innerHTML = plan.assets
    .map(
      (asset) =>
        `<button class="asset-button" data-add-asset="${esc(asset.id)}" style="--asset-color:${esc(asset.color)}" ${plan.objects.length >= 40 ? "disabled" : ""}><span class="asset-plus" aria-hidden="true">+</span><span class="asset-art" aria-hidden="true">${symbols[asset.kind] || symbols.imported}</span><strong>${esc(asset.name)}</strong><small>${asset.dimensions.width.toFixed(2)} × ${asset.dimensions.depth.toFixed(2)} m</small></button>`,
    )
    .join("");
  $("#asset-library")
    .querySelectorAll("button")
    .forEach(
      (button) =>
        (button.onclick = () =>
          mutate((draft) => {
            const asset = draft.assets.find(
              (a) => a.id === button.dataset.addAsset,
            );
            const id = uniqueId();
            draft.objects.push({
              id,
              assetId: asset.id,
              name: asset.name,
              x: 0,
              z: 0,
              yaw: 0,
              scale: 1,
            });
            selected = id;
            notice(
              `已加入${asset.name}。默认放在原点，请调整位置并查看几何提醒。`,
            );
          })),
    );
  $("#object-count").textContent = `${plan.objects.length} / 40`;
  $("#object-list").innerHTML = plan.objects.length
    ? plan.objects
        .map((item, index) => {
          const asset = plan.assets.find((a) => a.id === item.assetId),
            issues = analysis.issues.filter((issue) =>
              issue.objects.includes(item.id),
            );
          const danger = issues.some((issue) =>
            ["overlap", "contact", "outside"].includes(issue.kind),
          );
          return `<button class="object-button ${selected === item.id ? "active" : ""}" data-select="${esc(item.id)}" aria-pressed="${selected === item.id}" style="--asset-color:${esc(asset.color)}"><span class="object-icon" aria-hidden="true">${symbols[asset.kind] || symbols.imported}</span><span class="object-name">${esc(item.name)}</span><small>${String(index + 1).padStart(2, "0")}</small><i class="object-status ${danger ? "danger" : issues.length ? "warning" : ""}" aria-label="${issues.length}条提醒"></i></button>`;
        })
        .join("")
    : '<p class="persistence-note">场景还没有物件。点击上方素材开始布置。</p>';
  $("#object-list")
    .querySelectorAll("button")
    .forEach(
      (button) =>
        (button.onclick = () => {
          selected = button.dataset.select;
          render();
          document
            .querySelector(`[data-select="${selected}"]`)
            ?.focus({ preventScroll: true });
        }),
    );
}
function renderInspector() {
  const item = plan.objects.find((candidate) => candidate.id === selected),
    target = $("#inspector");
  if (!item) {
    target.innerHTML =
      '<p class="persistence-note">先在场景或左侧清单中选择一个物件。可用键盘方向按钮和数值输入精确摆放。</p>';
    return;
  }
  const asset = plan.assets.find((a) => a.id === item.assetId),
    imported = asset.source.type !== "original-procedural",
    proxy = imported && !geometryMatches(asset, runtime.get(asset.id));
  target.innerHTML = `<label class="field-label">物件名称<input id="item-name" type="text" maxlength="100" value="${esc(item.name)}"></label><div class="dimension-strip"><span><small>宽 W</small>${(asset.dimensions.width * item.scale).toFixed(2)}m</span><span><small>深 D</small>${(asset.dimensions.depth * item.scale).toFixed(2)}m</span><span><small>高 H</small>${(asset.dimensions.height * item.scale).toFixed(2)}m</span></div><div class="field-row"><label>位置 X / m<input id="item-x" type="number" step="0.1" min="-50" max="50" value="${item.x}"></label><label>位置 Z / m<input id="item-z" type="number" step="0.1" min="-50" max="50" value="${item.z}"></label></div><div class="field-row"><label>旋转 / °<input id="item-yaw" type="number" step="5" min="-3600" max="3600" value="${item.yaw}"></label><label>等比缩放<input id="item-scale" type="number" step="0.05" min="0.05" max="10" value="${item.scale}"></label></div><button id="apply-item">应用数值</button><div class="nudge-pad" aria-label="每次移动0.1米"><button data-nudge="0,-0.1" aria-label="向北移动0.1米">↑</button><button data-nudge="-0.1,0" aria-label="向西移动0.1米">←</button><span class="nudge-center">0.1 m</span><button data-nudge="0.1,0" aria-label="向东移动0.1米">→</button><button data-nudge="0,0.1" aria-label="向南移动0.1米">↓</button></div><div class="item-actions"><button id="rotate-item">旋转90°</button><button id="duplicate-item" ${plan.objects.length >= 40 ? "disabled" : ""}>复制</button><button id="delete-item">移除</button></div><div class="provenance"><strong>${asset.source.type === "aholo-export-user-declared" ? "Aholo Lux3D 导出 · 用户自述，未核验" : imported ? "本地导入 · 来源由使用者确认" : "本项目原创程序几何"}</strong>${proxy ? '<span class="proxy-label">当前显示包围代理。重新导入同一文件与单位可恢复网格；尺寸仍参与检查。</span>' : ""}<p>${esc(asset.source.name)}${asset.source.bytes ? `<br>${(asset.source.bytes / 1024).toFixed(1)} KiB · ${asset.source.vertexCount} 顶点 · ${asset.source.triangleCount} 三角形` : ""}</p>${asset.source.sha256 ? `<p>文件 SHA-256<br><code>${esc(asset.source.sha256)}</code></p>` : ""}${asset.warnings.map((warning) => `<p>ⓘ ${esc(warning)}</p>`).join("")}</div>`;
  for (const [id, field] of [
    ["item-name", "name"],
    ["item-x", "x"],
    ["item-z", "z"],
    ["item-yaw", "yaw"],
    ["item-scale", "scale"],
  ])
    $(`#${id}`).onchange = (event) =>
      mutate((draft) => {
        draft.objects.find((candidate) => candidate.id === selected)[field] =
          field === "name"
            ? event.target.value.trim() || "未命名物件"
            : Number(event.target.value);
      });
  $("#apply-item").onclick = () => {
    const values = {
      name: $("#item-name").value.trim() || "未命名物件",
      x: Number($("#item-x").value),
      z: Number($("#item-z").value),
      yaw: Number($("#item-yaw").value),
      scale: Number($("#item-scale").value),
    };
    mutate((draft) => Object.assign(draft.objects.find((item) => item.id === selected), values));
  };
  target.querySelectorAll("[data-nudge]").forEach(
    (button) =>
      (button.onclick = () => {
        const [dx, dz] = button.dataset.nudge.split(",").map(Number);
        nudge(dx, dz);
      }),
  );
  $("#rotate-item").onclick = () =>
    mutate((draft) => {
      const object = draft.objects.find(
        (candidate) => candidate.id === selected,
      );
      object.yaw = (object.yaw + 90) % 360;
    });
  $("#duplicate-item").onclick = () =>
    mutate((draft) => {
      const object = draft.objects.find(
          (candidate) => candidate.id === selected,
        ),
        copy = {
          ...object,
          id: uniqueId(),
          name: `${object.name.slice(0, 85)} 副本`,
          x: Math.min(50, object.x + 0.3),
          z: Math.min(50, object.z + 0.3),
        };
      draft.objects.push(copy);
      selected = copy.id;
    });
  $("#delete-item").onclick = () =>
    mutate((draft) => {
      draft.objects = draft.objects.filter(
        (candidate) => candidate.id !== selected,
      );
      selected = draft.objects[0]?.id || null;
    });
}
function nudge(dx, dz) {
  mutate((draft) => {
    const object = draft.objects.find((item) => item.id === selected);
    if (!object) return;
    object.x = Math.round((object.x + dx) * 1000) / 1000;
    object.z = Math.round((object.z + dz) * 1000) / 1000;
  });
}
function renderChecks() {
  const counts = [
    ["overlaps", "重叠 / 接触"],
    ["narrowGaps", "小于自定间隙"],
    ["outside", "房间边界之外"],
    ["reserved", "进入留白带"],
  ];
  $("#summary").innerHTML = counts
    .map(
      ([key, label]) =>
        `<div class="summary-card ${analysis.summary[key] ? "bad" : ""}"><span>${label}</span><b>${analysis.summary[key]}</b></div>`,
    )
    .join("");
  $("#check-badge").textContent = analysis.issues.length
    ? `${analysis.issues.length} 条几何提醒`
    : "暂无几何提醒";
  $("#check-badge").classList.toggle("good", !analysis.issues.length);
  $("#issues").innerHTML = analysis.issues.length
    ? analysis.issues
        .map(
          (issue) =>
            `<button class="issue-button ${["overlap", "contact", "outside"].includes(issue.kind) ? "danger" : ""}" data-issue="${esc(issue.id)}"><span class="issue-kind" aria-hidden="true">${issue.kind === "overlap" ? "⊠" : issue.kind === "zone" ? "▥" : issue.kind === "outside" ? "↗" : "↔"}</span><span class="issue-copy"><strong>${esc(issue.title)}</strong><p>${esc(issue.detail)}</p></span><span class="issue-arrow" aria-hidden="true">↗</span></button>`,
        )
        .join("")
    : '<div class="empty-check">给物件一点距离，也给想象一点余地。<br>在当前自定条件下，未发现包围代理提醒。</div>';
  $("#issues")
    .querySelectorAll("button")
    .forEach(
      (button) =>
        (button.onclick = () => {
          selected = analysis.issues.find(
            (issue) => issue.id === button.dataset.issue,
          ).objects[0];
          render();
          $("#item-name")?.focus({ preventScroll: true });
        }),
    );
}
function currentComparison() {
  return snapshots.a && snapshots.b
    ? comparePlans(snapshots.a, snapshots.b)
    : null;
}
function renderSnapshots() {
  for (const slot of ["a", "b"]) {
    const snapshot = snapshots[slot],
      summary = snapshot ? analyzePlan(snapshot).summary : null;
    $(`#snapshot-${slot}`).innerHTML =
      `<span class="snapshot-letter">${slot.toUpperCase()}</span><div class="snapshot-copy"><strong>${snapshot ? esc(snapshot.name) : "还没有保存想法"}</strong><p>${summary ? `${summary.objects} 件物件 · ${summary.total} 条提醒<br>${snapshot.room.width} × ${snapshot.room.depth}m · 间隙 ${snapshot.clearance}m` : "把当前布置存为快照，之后可以随时载入。"}</p></div><div class="snapshot-actions"><button data-save-slot="${slot}">${snapshot ? "覆盖为当前" : "存为快照"}</button><button data-load-slot="${slot}" ${snapshot ? "" : "disabled"}>载入方案</button></div>`;
  }
  document.querySelectorAll("[data-save-slot]").forEach(
    (button) =>
      (button.onclick = () => {
        snapshots[button.dataset.saveSlot] = clone(plan);
        save();
        renderSnapshots();
        notice(
          `已保存快照 ${button.dataset.saveSlot.toUpperCase()}。再调整布置，保存另一份进行比较。`,
        );
      }),
  );
  document.querySelectorAll("[data-load-slot]").forEach(
    (button) =>
      (button.onclick = () => {
        const source = snapshots[button.dataset.loadSlot];
        if (!source) return;
        remember(clone(plan));
        plan = clone(source);
        selected = plan.objects[0]?.id || null;
        save();
        render();
        notice(`已载入快照 ${button.dataset.loadSlot.toUpperCase()}。`);
      }),
  );
  const comparison = currentComparison();
  if (!comparison) {
    $("#comparison").innerHTML =
      '<p class="comparison-empty">保存 A 和 B 后，这里会显示同一组指标的并排比较。</p>';
    return;
  }
  const rows = [
    ["objects", "物件数"],
    ["overlaps", "重叠 / 接触"],
    ["narrowGaps", "小于自定间隙"],
    ["outside", "边界之外"],
    ["reserved", "留白带提醒"],
    ["total", "提醒总数"],
  ];
  $("#comparison").innerHTML =
    `<table><caption>${esc(comparison.warning)}</caption><thead><tr><th scope="col">几何代理结果</th><th scope="col">A · ${esc(comparison.a.name)}</th><th scope="col">B · ${esc(comparison.b.name)}</th><th scope="col">B − A</th></tr></thead><tbody>${rows.map(([key, label]) => `<tr><th scope="row">${label}</th><td>${comparison.a.summary[key]}</td><td>${comparison.b.summary[key]}</td><td>${comparison.delta[key] > 0 ? "+" : ""}${comparison.delta[key]}</td></tr>`).join("")}</tbody></table>`;
}
function render() {
  analysis = analyzePlan(plan);
  if (!plan.objects.some((item) => item.id === selected))
    selected = plan.objects[0]?.id || null;
  $("#plan-name").value = plan.name;
  $("#room-label").textContent =
    `${plan.room.width.toFixed(1)} × ${plan.room.depth.toFixed(1)} m`;
  $("#room-width").value = plan.room.width;
  $("#room-depth").value = plan.room.depth;
  $("#clearance").value = plan.clearance;
  $("#zone-enabled").checked = plan.zone.enabled;
  $("#zone-width").value = plan.zone.width;
  $("#zone-width").max = plan.room.width;
  $("#zone-width").disabled = !plan.zone.enabled;
  $("#undo").disabled = !undoStack.length;
  $("#redo").disabled = !redoStack.length;
  renderLibrary();
  renderInspector();
  renderChecks();
  renderSnapshots();
  view.update(plan, analysis, selected, runtime);
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function markdownReport(report) {
  const p = report.plan,
    a = report.analysis;
  return [
    "# 留白实验室 · 布置与几何间距报告",
    "",
    `方案：${p.name}`,
    `生成时间：${report.createdAt}`,
    `房间：${p.room.width} × ${p.room.depth} m；自定间隙：${p.clearance} m；中央留白带：${p.zone.enabled ? p.zone.width + " m" : "关闭"}`,
    "",
    "> 这是保守的水平包围矩形几何排练，不是安全、承重、消防、人体可通行或无障碍法规合格判断。",
    "",
    "## 方法与来源",
    "",
    ...report.limitations.map((line) => `- ${line}`),
    "",
    "Aholo Lux3D 实际使用与导出兼容性待账号验证。程序示例及测试资产均为本项目原创，不是 Lux3D 生成证据。",
    "",
    "## 物件与变换（米、度）",
    "",
    "| 物件 | 资产 | X | Z | 旋转 | 等比缩放 |",
    "|---|---|---:|---:|---:|---:|",
    ...p.objects.map(
      (item) =>
        `| ${item.name} | ${item.assetId} | ${item.x} | ${item.z} | ${item.yaw} | ${item.scale} |`,
    ),
    "",
    "## 几何提醒",
    "",
    ...(a.issues.length
      ? a.issues.map((issue) => `- **${issue.title}**：${issue.detail}`)
      : ["在当前自定参数下，未发现包围代理提醒。"]),
    "",
    "## 每对物件的水平代理间隙",
    "",
    "| 物件 A | 物件 B | 间隙 m | 状态 |",
    "|---|---|---:|---|",
    ...a.pairs.map(
      (pair) =>
        `| ${pair.aName} | ${pair.bName} | ${pair.gap.toFixed(3)} | ${pair.status} |`,
    ),
    "",
    "负值为包围代理最小分离位移，零为接触，正值为边界间最短距离。",
    "",
    "## 资产声明与复核",
    "",
    ...p.assets.map(
      (asset) =>
        `- **${asset.name}**：${asset.dimensions.width.toFixed(4)} × ${asset.dimensions.depth.toFixed(4)} × ${asset.dimensions.height.toFixed(4)} m；来源类型 ${asset.source.type}；${asset.source.name}；SHA-256 ${asset.source.sha256 || "不适用（程序几何）"}；Aholo使用核验：未核验。${asset.warnings.join("；")}`,
    ),
    "",
    "## A/B 方案比较",
    "",
    report.comparison
      ? JSON.stringify(report.comparison, null, 2)
      : "尚未保存两份快照。",
    "",
    "模型字节没有包含在本报告中。请保留并按 SHA-256 核对原始文件；刷新后需要重新导入才能恢复网格预览。",
    "",
  ].join("\n");
}
async function readModel(file) {
  if (!file) return;
  $("#import-button").disabled = true;
  try {
    if (plan.assets.length >= 60)
      throw new Error("最多60种资产；请新开方案或减少资产后重试。");
    if (
      file.size > IMPORT_LIMITS.fileBytes ||
      !/\.(gltf|glb)$/i.test(file.name)
    )
      throw new Error("请选择不超过12 MiB的.gltf或.glb文件。");
    const bytes = new Uint8Array(await file.arrayBuffer()),
      unitScale = Number($("#import-unit").value),
      imported = importGLTF(bytes, file.name, unitScale);
    if (!crypto.subtle)
      throw new Error(
        "文件指纹需要HTTPS或localhost。请使用本地开发服务或HTTPS预览。",
      );
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const id = `import-${hash.slice(0, 20)}-${unitScale === 1 ? "m" : unitScale === 0.01 ? "cm" : "mm"}`;
    runtime.set(id, imported);
    mutate((draft) => {
      const existing = draft.assets.find((asset) => asset.id === id);
      if (!existing)
        draft.assets.push({
          id,
          name: imported.name,
          kind: "imported",
          color: "#829e94",
          dimensions: imported.dimensions,
          source: {
            type:
              $("#import-source").value === "aholo"
                ? "aholo-export-user-declared"
                : "local-file",
            name: file.name,
            bytes: file.size,
            sha256: hash,
            declaredUnitScale: unitScale,
            verifiedAholo: false,
            vertexCount: imported.vertexCount,
            triangleCount: imported.triangleCount,
          },
          warnings: imported.warnings,
        });
      else {
        existing.dimensions = imported.dimensions;
        existing.warnings = imported.warnings;
        existing.source = {
          type:
            $("#import-source").value === "aholo"
              ? "aholo-export-user-declared"
              : "local-file",
          name: file.name,
          bytes: file.size,
          sha256: hash,
          declaredUnitScale: unitScale,
          verifiedAholo: false,
          vertexCount: imported.vertexCount,
          triangleCount: imported.triangleCount,
        };
      }
      const placed = draft.objects.find((item) => item.assetId === id);
      if (placed) selected = placed.id;
      else if (draft.objects.length < 40) {
        selected = uniqueId();
        draft.objects.push({
          id: selected,
          assetId: id,
          name: imported.name,
          x: 0,
          z: 0,
          yaw: 0,
          scale: 1,
        });
      }
      notice(
        `已读取 ${file.name}：${imported.vertexCount} 顶点，尺寸 ${imported.dimensions.width.toFixed(2)} × ${imported.dimensions.depth.toFixed(2)} × ${imported.dimensions.height.toFixed(2)}m。请人工核对单位。${imported.warnings.length ? " 已在检查器标注导入限制。" : ""}`,
      );
    });
  } catch (error) {
    notice(`导入未完成：${error.message}`, true);
  } finally {
    $("#import-button").disabled = false;
    $("#model-file").value = "";
  }
}
function showInfo(kind) {
  $("#info-title").textContent =
    kind === "method" ? "我们量的是什么？" : "一个明确、有限的导入子集";
  $("#info-content").innerHTML =
    kind === "method"
      ? `<p>每件资产先计算局部包围盒，将其宽与深投影为一个定向矩形，再应用摆放旋转与缩放。重叠由分离轴测试判断，正向间隙由矩形边界最近距离计算。</p><ul>${LIMITATIONS.map((line) => `<li>${esc(line)}</li>`).join("")}</ul><p>默认内置几何与可下载测试文件是本项目原创。没有连接 Aholo API，也没有替你生成参赛使用证据。</p>`
      : "<ul><li>支持 glTF 2.0 JSON（内嵌 base64 buffer）和 GLB 2.0（单个内嵌 BIN），最高12 MiB文件、20 MiB解码缓冲、200,000顶点、80图元、400节点。</li><li>只支持静态无压缩 TRIANGLES、FLOAT32 VEC3 POSITION、可选 unsigned 8/16/32位索引、节点TRS或仿射matrix及层级变换。按场景实际变换展开后居中落地。</li><li>仅显示 baseColorFactor；贴图和动画被明确忽略，不下载任何外部文件。场景文件里的远程URL不会被访问。</li><li>不支持外部.bin、Draco、Meshopt、量化坐标、蒙皮、形变目标、sparse访问器或其他必须扩展。请在原工具中导出未压缩静态网格。</li><li>glTF默认以米计量；厘米/毫米选项是对异常导出或已知单位的人工覆盖。几何间距不代表实际摆放的精确测量。</li><li>尚未用Aholo账号实际生成和导出模型，不能保证其所有导出选项都在此子集内。导入Aholo来源只是用户声明，未被本工具核验。</li></ul>";
  $("#info-dialog").showModal();
}

$("#plan-name").onchange = (event) =>
  mutate((draft) => {
    draft.name = event.target.value.trim() || "未命名布置";
  });
for (const [id, target] of [
  ["room-width", "width"],
  ["room-depth", "depth"],
])
  $(`#${id}`).onchange = (event) =>
    mutate((draft) => {
      draft.room[target] = Number(event.target.value);
      draft.zone.width = Math.min(draft.zone.width, draft.room.width);
    });
$("#clearance").onchange = (event) =>
  mutate((draft) => {
    draft.clearance = Number(event.target.value);
  });
$("#zone-enabled").onchange = (event) =>
  mutate((draft) => {
    draft.zone.enabled = event.target.checked;
  });
$("#zone-width").onchange = (event) =>
  mutate((draft) => {
    draft.zone.width = Number(event.target.value);
  });
$("#undo").onclick = () => {
  if (!undoStack.length) return;
  redoStack.push(clone(plan));
  plan = undoStack.pop();
  render();
  save();
  notice("已撤回上一步。");
};
$("#redo").onclick = () => {
  if (!redoStack.length) return;
  undoStack.push(clone(plan));
  plan = redoStack.pop();
  render();
  save();
  notice("已重做下一步。");
};
document.querySelectorAll("[data-mode]").forEach(
  (button) =>
    (button.onclick = () => {
      view.mode = button.dataset.mode;
      document
        .querySelectorAll("[data-mode]")
        .forEach((candidate) =>
          candidate.setAttribute("aria-pressed", String(candidate === button)),
        );
      $("#interaction-hint").textContent =
        view.mode === "move"
          ? "拖动物件 · 0.1m吸附 · 方向键微调"
          : "拖动旋转 · 滚轮缩放 · 点击选中";
    }),
);
$("#iso-view").onclick = () => view.setView("iso");
$("#top-view").onclick = () => view.setView("top");
$("#toggle-bounds").onclick = () => {
  view.showBounds = !view.showBounds;
  $("#toggle-bounds").setAttribute("aria-pressed", String(view.showBounds));
  view.update(plan, analysis, selected, runtime);
};
$("#import-button").onclick = () => $("#model-file").click();
$("#model-file").onchange = (event) => readModel(event.target.files[0]);
$("#load-project").onclick = () => $("#project-file").click();
$("#project-file").onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error("方案JSON应小于2 MiB。");
    const value = JSON.parse(await file.text());
    if (
      value.format !== "scene-clearance-project-v1" ||
      !validatePlan(value.plan)
    )
      throw new Error("不是可读取的方案JSON；报告文件不能代替方案文件。");
    remember(clone(plan));
    plan = value.plan;
    snapshots = {
      a: validatePlan(value.snapshots?.a) ? value.snapshots.a : null,
      b: validatePlan(value.snapshots?.b) ? value.snapshots.b : null,
    };
    selected = plan.objects[0]?.id || null;
    render();
    save();
    notice(
      "方案已打开。导入资产若显示包围代理，请重新导入匹配原文件恢复网格。",
    );
  } catch (error) {
    notice(`方案未打开：${error.message}`, true);
  } finally {
    event.target.value = "";
  }
};
$("#export-project").onclick = () => {
  download(
    JSON.stringify(
      { format: "scene-clearance-project-v1", plan, snapshots },
      null,
      2,
    ),
    "scene-clearance-project.json",
    "application/json",
  );
  notice("已保存方案JSON。模型字节不包含在方案中，请保留原始资产文件。");
};
$("#export-json").onclick = () =>
  download(
    JSON.stringify(makeReport(plan, currentComparison(), snapshots), null, 2),
    "scene-clearance-report.json",
    "application/json",
  );
$("#export-report").onclick = () =>
  download(
    markdownReport(makeReport(plan, currentComparison(), snapshots)),
    "scene-clearance-report.md",
    "text/markdown;charset=utf-8",
  );
$("#method-button").onclick = () => showInfo("method");
$("#subset-button").onclick = () => showInfo("subset");
$("#close-info").onclick = $("#info-done").onclick = () =>
  $("#info-dialog").close();
$("#reset-demo").onclick = () => $("#reset-dialog").showModal();
$("#reset-cancel").onclick = () => $("#reset-dialog").close();
$("#reset-confirm").onclick = () => {
  remember(clone(plan));
  plan = createPlan();
  selected = plan.objects[0].id;
  $("#reset-dialog").close();
  render();
  save();
  notice("已打开原创程序场景。快照保持可用；该示例不代表Aholo生成内容。");
};
view.canvas.addEventListener("keydown", (event) => {
  const offset = event.shiftKey ? 0.5 : 0.1,
    directions = {
      ArrowUp: [0, -offset],
      ArrowDown: [0, offset],
      ArrowLeft: [-offset, 0],
      ArrowRight: [offset, 0],
    };
  if (directions[event.key] && selected) {
    event.preventDefault();
    nudge(...directions[event.key]);
    view.canvas.focus({ preventScroll: true });
  }
});
render();
save();
