import { upstreamNodes } from "./canvasGroups.js";
import { frameAsset } from "./studio.js";
import { stageObject } from "./director-stage.js";

export const maxStageReferences = 4;
export function canvasStageImages(board, nodeId, assets) {
  const upstream = upstreamNodes(board,nodeId);
  const connected = new Set(upstream.map(n => n.id));
  const byId = new Map(assets.map(a => [a.id,a]));
  const images = new Map();
  for (const n of [...upstream,...board.nodes]) {
    if (n.id === nodeId) continue;
    const a = n.data.kind === "shot" ? frameAsset(n,board,assets) : byId.get(n.data.assetId);
    if (a?.kind === "image" && !images.has(a.id))
      images.set(a.id,{ id:a.id, title:n.data.title || a.name, url:a.url, connected:connected.has(n.id) });
  }
  return [...images.values()];
}
export function stageIsUntouched(stage) {
  if (stage.objects.length !== 2 || stage.animation || stage.backgroundId || stage.referenceIds?.length) return false;
  return ["actor","camera"].every(type => {
    const item = stage.objects.find(o => o.type === type);
    if (!item || item.keys?.length || item.referenceAssetId || item.locked || item.hidden || Object.values(item.joints || {}).some(Boolean)) return false;
    const model = stageObject(type);
    return Object.keys(model).every(k => k === "id" || JSON.stringify(model[k]) === JSON.stringify(item[k]));
  });
}
export function applyStagePlan(current, draft, replaceDefaults) {
  const existing = replaceDefaults && stageIsUntouched(current) ? [] : current.objects;
  const objects = [...existing, ...draft.objects];
  if (objects.length > 64) throw Error("场景最多容纳 64 个对象，请移除部分对象后再应用");
  const referenceIds = [...new Set([...(current.referenceIds || []), ...draft.referenceIds])];
  if (referenceIds.length > 64) throw Error("此导演台已使用 64 张不同的参考图，请另建导演台");
  return { ...current, objects, referenceIds, cameraId:existing.length ? current.cameraId : draft.cameraId };
}
