import { stagePoses, validJoints, stageSwitches } from "./stage-actions.js";
import { stageShapes } from "./stage-props.js";
import { endFrameOf, maxEndFrame, validMarkers } from "./stage-animation.js";
export const stageFrames = {
  "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1440, 1440], "4:3": [1440, 1080], "2.39:1": [1912, 800],
};
export { stagePoses } from "./stage-actions.js";
export { stageShapes };
export const stageColors = ["#d4a979", "#83b3bc", "#bc92ac", "#99ad87", "#879dc4"];
export function stageObject(type, index = 0) {
  if (type === "prop") return {
    id:crypto.randomUUID(), type, name:"布景 " + (index + 1), position:[index,0,0], rotation:[0,0,0],
    shape:"box", size:[1,1,1], color:"#938b7c",
  };
  const actor = type === "actor";
  return {
    id: crypto.randomUUID(), type, name: (actor ? "角色 " : "机位 ") + (index + 1),
    position: actor ? [index % 5 * 1.1, 0, -Math.floor(index / 5)] : [index % 3 * 1.6, 1.48, 4.8 + Math.floor(index / 3)],
    rotation: actor ? [0, 0, 0] : [-6, index % 3 * 17, 0],
    ...(actor ? { scale: 1, color: stageColors[index % stageColors.length], pose: "standing" } : { fov: 34 }),
  };
}
export function newStage(ratio = "16:9") {
  const camera = stageObject("camera");
  return { ratio: Object.hasOwn(stageFrames, ratio) ? ratio : "16:9", cameraId: camera.id, objects: [stageObject("actor"), camera] };
}
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
function vector(value, min, max) {
  return Array.isArray(value) && value.length === 3 && value.every(v => inRange(v, min, max));
}
export function validStage(stage) {
  if (!stage || !Object.hasOwn(stageFrames, stage.ratio) || !Array.isArray(stage.objects) ||
      stage.objects.length > 64 || (stage.backgroundMode !== undefined && !["flat", "panorama"].includes(stage.backgroundMode)) || (stage.backgroundId != null && typeof stage.backgroundId !== "string")) return false;
  if (stage.settings !== undefined && (!stage.settings || typeof stage.settings !== "object" || Array.isArray(stage.settings) ||
      !Object.entries(stage.settings).every(([id,value]) => Object.hasOwn(stageSwitches,id) && typeof value === "boolean"))) return false;
  if (stage.panoramaYaw !== undefined && !inRange(stage.panoramaYaw,-180,180)) return false;
  const end = endFrameOf(stage);
  if (!Number.isInteger(end) || end < 1 || end > maxEndFrame) return false;
  if (stage.referenceIds !== undefined && (!Array.isArray(stage.referenceIds) || stage.referenceIds.length > 64 ||
      stage.referenceIds.some(id => typeof id !== "string" || !id || id.length > 160))) return false;
  const ids = new Set();
  for (const item of stage.objects) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 100 || ids.has(item.id) ||
        typeof item.name !== "string" || item.name.length > 80) return false;
    if (["hidden","locked"].some(field => item[field] !== undefined && typeof item[field] !== "boolean")) return false;
    ids.add(item.id);
    const transform = k => vector(k.position, -100, 100) && vector(k.rotation, -360, 360) &&
      (item.type !== "actor" || (Object.hasOwn(stagePoses, k.pose) && validJoints(k.joints) && inRange(k.scale,0.1,6))) &&
      (item.type !== "camera" || inRange(k.fov,15,100));
    if (!transform(item) || (item.keys !== undefined && !validMarkers(item.keys,end,transform))) return false;
    if (!["camera","prop","actor"].includes(item.type)) return false;
    if (item.type !== "camera" && (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color))) return false;
    if (item.referenceAssetId != null && (item.type !== "actor" || typeof item.referenceAssetId !== "string" || item.referenceAssetId.length > 160)) return false;
    if (item.type === "prop" && (!Object.hasOwn(stageShapes,item.shape) || !vector(item.size,0.02,100))) return false;
  }
  if (stage.animation !== undefined && (!stage.animation || !validMarkers(stage.animation.cuts,end,
      k => stage.objects.some(o => o.type === "camera" && o.id === k.cameraId)))) return false;
  return stage.objects.some(o => o.type === "camera" && o.id === stage.cameraId);
}
