import { newStage } from "./director-stage.js";
import { upstreamNodes } from "./canvasGroups.js";

export const kinds = {
  script: "剧本",
  text: "文本",
  shot: "分镜",
  stage: "导演台",
  image: "图片",
  video: "视频",
  audio: "音频",
};
export const shots = [
  ["coast", "风暴前的灯塔", "远景，固定机位。风暴将至，灯塔第一次扫过礁岸。"],
  [
    "operator",
    "接通频道",
    "中近景，缓慢推进。值班员戴上耳机，辨认杂音中的呼救。",
  ],
  ["receiver", "微弱的信号", "特写。指示灯突然亮起，电台传来断续的坐标。"],
  ["flare", "海上回应", "大远景。红色信号弹划破海面，留下一道短暂的轨迹。"],
  ["dawn", "天色将明", "背影，全景。值班员走出电台，望向渐亮的海平线。"],
  ["dial", "最后一次呼叫", "细节特写。她轻轻旋回频率，耳机里终于传来回应。"],
];
export const samples = [
  {
    key: "tide",
    name: "潮汐电台",
    subtitle: "悬疑短片",
    cover: "coast",
    indexes: [0, 1, 2, 3, 4, 5],
  },
  {
    key: "signal",
    name: "深夜频率",
    subtitle: "人物练习",
    cover: "operator",
    indexes: [1, 2, 5],
  },
  {
    key: "flare",
    name: "海面的回信",
    subtitle: "氛围短片",
    cover: "flare",
    indexes: [0, 3, 4],
  },
];
export const makeId = () => crypto.randomUUID();
export function makeNode(kind, position, data = {}) {
  return {
    id: makeId(),
    type: "studio",
    position,
    data: {
      kind,
      title: kinds[kind],
      text: "",
      duration: 3,
      assetId: "",
      ...(kind === "stage" && !data.stage ? { stage: newStage() } : {}),
      ...data,
    },
  };
}
export function makeBoard(key, title, script = "", series = {}) {
  const sample = samples.find((it) => it.key === key);
  const source = makeNode(
    "script",
    { x: 0, y: 55 },
    {
      title: sample?.name || "我的剧本",
      text: sample?.indexes.map((i) => shots[i][2]).join("\n") || script,
    },
  );
  const sequence = (sample?.indexes || []).map((index, i) => {
    const [assetId, title, text] = shots[index];
    return makeNode(
      "shot",
      { x: 335 + 300 * Math.floor(i / 2), y: (i % 2) * 258 },
      { assetId, title, text },
    );
  });
  if (!sample && script.trim()) sequence.push(...scriptShots(source, 0, 325));
  return {
    series,
    name: title || sample?.name || "未命名画布",
    nodes: [source, ...sequence],
    edges: sequence.map((n) => ({
      id: makeId(),
      source: source.id,
      target: n.id,
    })),
    order: sequence.map((n) => n.id),
  };
}
export function splitScript(text) {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.length === 1
    ? (lines[0].match(/[^。！？!?]+[。！？!?]?/g) || [])
        .map((s) => s.trim())
        .filter(Boolean)
    : lines;
}
export function scriptShots(source, offset, x) {
  return splitScript(source.data.text).map((text, i) =>
    makeNode(
      "shot",
      { x: x + Math.floor(i / 3) * 295, y: source.position.y + (i % 3) * 218 },
      { title: "镜头 " + (offset + i + 1), text },
    ),
  );
}
export function currentShots(board) {
  const nodes = new Map(board.nodes.map((n) => [n.id, n]));
  return board.order.map((id) => nodes.get(id)).filter(Boolean);
}
export function frameAsset(node, board, assets) {
  const direct = assets.find((a) => a.id === node.data.assetId);
  if (direct) return direct;
  for (const from of upstreamNodes(board, node.id)) {
    if (!["image", "video"].includes(from.data.kind)) continue;
    const item = assets.find((a) => a.id === from.data.assetId);
    if (item) return item;
  }
}
