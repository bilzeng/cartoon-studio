// Runs four real model jobs and two local exports. Set STUDIO_URL to a running studio.
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { adoptTake } from "../shared/storyboard.js";

const base = new URL(
  "/api/",
  process.env.STUDIO_URL || "http://127.0.0.1:4317",
);
async function api(path, method = "GET", body) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || response.statusText);
  return value;
}
const cards = [
  {
    id: "keeper",
    type: "character",
    name: "阿澜",
    description: "短黑发的年轻守灯人，穿靛蓝色雨披",
  },
  {
    id: "coastline",
    type: "scene",
    name: "退潮灯站",
    description: "黎明前的沿海石阶，远处小灯塔，海蓝与琥珀色光",
    imageId: "coast",
  },
  {
    id: "lamp",
    type: "prop",
    name: "引航灯",
    description: "黄铜框、透明玻璃罩、单枚暖橙色灯芯的手提灯",
  },
];
const shots = [
  {
    title: "潮线",
    text: "潮水退下，远处灯塔熄灭，青色湿石阶延伸至海边。",
    framing: "远景",
    camera: "固定机位",
    shotCast: "空镜，无人",
    referenceIds: ["coastline"],
    lighting: "黎明冷光",
    sound: "浪退过礁石",
  },
  {
    title: "点灯",
    text: "阿澜提起未点亮的黄铜灯，低头用火柴点燃灯芯。",
    framing: "半身中景",
    camera: "轻轻推近",
    referenceIds: ["keeper", "coastline", "lamp"],
    lighting: "暖光映亮雨披",
    dialogue: "阿澜：回家的路亮了。",
    sound: "火柴擦响",
  },
  {
    title: "回航",
    text: "石阶边的引航灯映在海水里，一艘小帆船循光靠岸。",
    framing: "广角全景",
    camera: "固定机位",
    shotCast: "空镜，无人",
    referenceIds: ["coastline", "lamp"],
    lighting: "天光渐白",
    sound: "远处船铃",
  },
];
const engine = await api("engine");
assert.ok(
  engine.imageModels?.some((m) => m.id === "studio:z-image-turbo") &&
    engine.video?.native,
  "本验收使用 Z-Image Turbo 与原生 Wan 2.1 文生视频",
);
let board = await api("projects", "POST", {
  name: "退潮灯站 · 第一集《点灯》",
  series: {
    style: "手绘二维漫剧，青蓝色和琥珀色，铅笔轮廓，无字幕无水印",
    ratio: "16:9",
  },
  script: shots.map((s) => s.text).join("\n"),
  referenceCards: cards,
});
const project = "projects/" + board.id;
const ids = board.order;
console.error("试片项目", board.id);
const save = (b) => api(project, "PUT", b);
board = await save({
  ...board,
  nodes: board.nodes.map((n) =>
    n.data.kind !== "shot"
      ? n
      : {
          ...n,
          data: { ...n.data, ...shots[ids.indexOf(n.id)], duration: 2 },
        },
  ),
});
async function waitJob(ticket) {
  const end = Date.now() + 65 * 60_000;
  while (Date.now() < end) {
    const row = (await api("jobs?project=" + board.id)).find(
      (j) => j.id === ticket.id,
    );
    if (row?.status === "done") return row;
    if (row?.status === "failed") throw Error(row.detail);
    await sleep(2000);
  }
  throw Error("任务超时 " + ticket.id);
}
async function generate(i, kind, imageId = "") {
  const shotId = ids[i];
  console.error("生成", i + 1, kind);
  const ticket = await api(project + "/generate", "POST", {
    shotId,
    kind,
    checkpoint: "studio:z-image-turbo",
    assetId: imageId,
    revision: board.revision,
  });
  await waitJob(ticket);
  const take = (await api(project + "/shots/" + shotId + "/takes")).find(
    (t) => t.id === ticket.id,
  );
  assert.equal(take.status, "done");
  assert.equal(take.shotId, shotId);
  assert.equal(take.snapshot.imageId, imageId);
  return take;
}
async function exportFilm() {
  const ticket = await api(project + "/export", "POST", {
    revision: board.revision,
  });
  return (await waitJob(ticket)).assetId;
}
const firstTakes = [];
for (const [i, kind, image] of [
  [0, "image", "coast"],
  [1, "video", ""],
  [2, "image", "coast"],
]) {
  const take = await generate(i, kind, image);
  firstTakes.push(take.id);
  board = await save(adoptTake(board, take));
}
const original = await exportFilm();
const before = structuredClone(board);
board = await save({
  ...board,
  nodes: board.nodes.map((n) =>
    n.id === ids[1]
      ? {
          ...n,
          data: {
            ...n.data,
            framing: "手部大特写",
            camera: "固定微距",
            text: "画面只见阿澜雨披的袖口、手指和灯芯。她划亮火柴，橙色小火苗映在玻璃罩上。",
          },
        }
      : n,
  ),
});
const changed = await generate(1, "video");
const fromServer = await api(project);
assert.deepEqual(
  fromServer.nodes.map((n) => n.data.assetId),
  before.nodes.map((n) => n.data.assetId),
);
board = await save(adoptTake(board, changed));
const revised = await exportFilm();
assert.notEqual(original, revised);
const counts = await Promise.all(
  ids.map(
    async (id) => (await api(project + "/shots/" + id + "/takes")).length,
  ),
);
assert.deepEqual(counts, [1, 2, 1]);
for (const i of [0, 2])
  assert.deepEqual(
    board.nodes.find((n) => n.id === ids[i]),
    before.nodes.find((n) => n.id === ids[i]),
  );
assert.deepEqual(board.order, before.order);
const adopted = (b) =>
  ids.map((id) => b.nodes.find((n) => n.id === id).data.assetId);
assert.notEqual(adopted(before)[1], adopted(board)[1]);
console.log(
  JSON.stringify(
    {
      project: board.id,
      ids,
      firstTakes,
      retake: changed.id,
      counts,
      initial: adopted(before),
      revised: adopted(board),
      originalFilm: original,
      revisedFilm: revised,
    },
    null,
    2,
  ),
);
