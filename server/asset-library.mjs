import { referenceTypes } from "../shared/storyboard.js";
import { imageSize } from "image-size";
import { visibleTags } from "../shared/asset-tags.js";
import { open } from "node:fs/promises";

export function assetBindings(board) {
  const bindings = new Map();
  function add(slot, id) { if (id) bindings.set(slot, id); }
  add("series", board.series?.refAssetId);
  for (const [i, card] of (board.referenceCards || []).entries())
    add("card/" + (card.id || i), card.imageId);
  for (const { id, data } of board.nodes || []) {
    add(id + "/asset", data.assetId);
    add(id + "/guide", data.guideAssetId);
    add(id + "/video-restore", data.videoRestoreSource?.assetId);
    if (data.kind === "stage") {
      add(id + "/panorama", data.stage?.backgroundId);
      for (const ref of data.stage?.referenceIds || []) add(id + "/stage-ref/" + ref,ref);
    }
    add(id + "/mark", data.imageMark?.assetId);
  }
  return bindings;
}

function existingUsage(board) {
  // Older canvases only know when the project containing the reference was saved.
  return board.assetUsage || Object.fromEntries([...assetBindings(board).values()].map(id => [id, board.updated]));
}

export function updatedAssetUsage(previous, board, now) {
  const usage = { ...(previous && existingUsage(previous)) };
  const before = previous ? assetBindings(previous) : new Map();
  for (const [slot, id] of assetBindings(board)) {
    if (before.get(slot) !== id) usage[id] = now;
  }
  return usage;
}

const subjects = [
  ["角色卡", /角色卡|角色设定图|character\s*(?:asset\s*card|sheet)/i],
  ["角色", /角色|人物|人像|肖像|三视图|定妆|portrait|character/i],
  ["场景", /场景|风景|环境图|空镜|全景|远景|海岸|灯塔|landscape|scenery|establishing shot/i],
  ["道具", /道具|物件|静物|\bprops?\b|still life/i],
  ["分镜", /分镜|镜头\s*\d|storyboard|shot[ _-]*\d/i],
  ["旁白", /旁白|配音|朗读|人声|voice[ -]?over|narration/i],
  ["对白", /对白|台词|dialogue/i],
  ["音乐", /音乐|配乐|伴奏|背景乐|\bbgm\b|soundtrack|music/i],
  ["音效", /音效|环境音|拟音|\bsfx\b|foley/i],
];

// ComfyUI writes the prompt graph as a PNG text chunk ahead of the pixels.
// Inspect node titles and positive prompt fields locally, retaining only matching labels.
const headerLimit = 1024 * 1024;
function pngSubjects(bytes) {
  const found = new Set();
  for (let pos = 8; pos + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(pos);
    const start = pos + 8, end = start + size;
    if (end + 4 > bytes.length || bytes.toString("ascii", pos + 4, start) === "IDAT") break;
    if (bytes.toString("ascii", pos + 4, start) === "tEXt" &&
        bytes.toString("ascii", start, start + 7) === "prompt\0") {
      let graph;
      try { graph = JSON.parse(bytes.toString("utf8", start + 7, end)); } catch { break; }
      if (!graph || typeof graph !== "object" || Array.isArray(graph)) break;
      const nodes = Object.entries(graph).filter(([, n]) => n && typeof n === "object");
      const negatives = new Set(nodes.map(([, n]) => n.inputs?.negative?.[0])
        .filter(v => typeof v === "number" || typeof v === "string").map(String));
      for (const [id, n] of nodes) {
        const title = typeof n._meta?.title === "string" ? n._meta.title : "";
        if (negatives.has(id) || /negative|负面/i.test(title)) continue;
        const text = [n.class_type, title, n.inputs?.text, n.inputs?.positive, n.inputs?.prompt]
          .filter(v => typeof v === "string").join(" ");
        for (const [tag, pattern] of subjects) if (pattern.test(text)) found.add(tag);
      }
      break;
    }
    pos = end + 4;
  }
  return [...found];
}
export function mediaFileTags(kind, buffer) {
  if (kind !== "image") return [];
  const bytes = Buffer.isBuffer(buffer) ? buffer.subarray(0, headerLimit) : Buffer.from(buffer).subarray(0, headerLimit);
  let info;
  try { info = imageSize(bytes); } catch { return []; }
  let { width, height } = info;
  if (info.orientation >= 5 && info.orientation <= 8) [width, height] = [height, width];
  const tags = info.type === "png" ? pngSubjects(bytes) : [];
  if (width && height) tags.push(width === height ? "方图" : width > height ? "横图" : "竖图");
  return tags;
}
export async function readMediaFileTags(asset, file) {
  if (asset.kind !== "image") return [];
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(Math.min((await handle.stat()).size, headerLimit));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return mediaFileTags(asset.kind, buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

export function assetCatalog(assets, projects, jobs, favorites, edits = {}) {
  const byId = new Map(assets.map(a => [a.id, { tags: new Set(), lastUsed: "" }]));
  function tag(id, value) { if (value?.trim()) byId.get(id)?.tags.add(value.trim().normalize("NFC")); }
  function classify(id, text) {
    for (const [name, match] of subjects) if (match.test(text || "")) tag(id, name);
  }
  function used(id, date) {
    const item = byId.get(id);
    if (item && date > item.lastUsed) item.lastUsed = date;
  }
  for (const { board } of projects) {
    for (const [id, date] of Object.entries(existingUsage(board))) used(id, date);
    for (const card of board.referenceCards || []) tag(card.imageId, referenceTypes[card.type]);
    tag(board.series?.refAssetId, "参考图");
    for (const { data } of board.nodes || []) {
      if (data.kind === "stage") { tag(data.stage?.backgroundId, "全景"); tag(data.assetId, "机位截图"); }
      if (data.kind === "shot") tag(data.assetId, "分镜");
      if (data.canvasGroup) tag(data.assetId, data.canvasGroupName);
      tag(data.guideAssetId, "参考图");
      tag(data.imageMark?.assetId, "参考图");
    }
  }
  for (const job of jobs) {
    for (const id of job.inputAssetIds || []) used(id, job.created);
    if (job.assetId) classify(job.assetId, job.detail);
    const shot = job.snapshot;
    if (!shot) continue;
    if (job.assetId) {
      tag(job.assetId, "分镜");
      classify(job.assetId, shot.title + " " + (shot.prompt || ""));
    }
    used(shot.imageId, job.created);
    for (const card of shot.references || []) {
      used(card.imageId, job.created);
      tag(card.imageId, referenceTypes[card.type]);
    }
  }
  const stars = new Set(favorites);
  return assets.map(a => {
    const { tags, lastUsed } = byId.get(a.id);
    for (const t of a.fileTags || []) tag(a.id, t);
    classify(a.id, a.name);
    tag(a.id, a.builtin ? "内置示例" : ({ generated: "生成素材", export: "导出成片" }[a.origin] || "本地导入"));
    const ext = /\.(\w+)$/.exec(a.file || a.url)?.[1];
    if (ext) tag(a.id, ext.toUpperCase());
    const autoTags = [...tags];
    const customTags = edits[a.id]?.customTags ?? a.importTags ?? [];
    const hiddenTags = edits[a.id]?.hiddenTags ?? [];
    return { ...a, autoTags, customTags, hiddenTags, tags: visibleTags(autoTags, customTags, hiddenTags),
      favorite: stars.has(a.id), lastUsed };
  });
}
