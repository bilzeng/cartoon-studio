import { seriesPrompt } from "./series.js";

export const referenceTypes = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};
export const shotFields = {
  framing: "景别",
  lighting: "光影氛围",
  camera: "运镜",
  dialogue: "对白／旁白",
  sound: "音效",
};
export function referencesForShot(board, data) {
  const cards = board.referenceCards || [];
  return (data.referenceIds || [])
    .map((id) => cards.find((c) => c.id === id))
    .filter(Boolean);
}
export function shotPrompt(board, data, kind = "image") {
  const refs = referencesForShot(board, data);
  const cast =
    data.emptyCast || refs.some((c) => c.type === "character")
      ? { ...board.series, cast: "" }
      : board.series;
  const lines = refs.map(
    (c) =>
      referenceTypes[c.type] +
      " · " +
      c.name +
      (c.description ? "：" + c.description : ""),
  );
  for (const [key, label] of Object.entries(shotFields)) {
    if (kind === "image" && (key === "dialogue" || key === "sound")) continue;
    if (data[key]?.trim()) lines.push(label + "：" + data[key].trim());
  }
  lines.push(data.text.trim());
  return seriesPrompt(
    cast || {},
    lines.filter(Boolean).join("\n"),
    data.emptyCast ? "空镜，无人出场" : data.shotCast,
  );
}
// The timeline consumes only the chosen file. Generating a candidate never modifies it.
export function adoptTake(board, take) {
  if (
    !take ||
    take.project !== board.id ||
    take.status !== "done" ||
    !take.assetId
  )
    throw Error("这个候选尚不可采用");
  if (!board.nodes.some((n) => n.id === take.shotId && n.data.kind === "shot"))
    throw Error("原分镜已不存在");
  return {
    ...board,
    nodes: board.nodes.map((n) =>
      n.id === take.shotId
        ? { ...n, data: { ...n.data, assetId: take.assetId } }
        : n,
    ),
  };
}
