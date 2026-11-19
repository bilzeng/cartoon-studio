import { gaitAt } from "./stage-walk.js";
export const stageFps = 24;
export const defaultEndFrame = 5 * stageFps;
export const maxEndFrame = 120 * stageFps;
export const endFrameOf = stage => stage.animation?.endFrame ?? defaultEndFrame;

export function keyValues(item) {
  const fields = { position: [...item.position], rotation: [...item.rotation] };
  if (item.type === "camera") fields.fov = item.fov;
  if (item.type === "actor") Object.assign(fields, { pose: item.pose, scale: item.scale });
  return fields;
}
const mix = (a, b, t) => a + (b - a) * t;
// Normalize angles to [-180, 180) so a pan across north follows the short arc.
const wrapAngle = angle => ((angle + 180) % 360 + 360) % 360 - 180;
export function sampleObject(item, frame) {
  const keys = item.keys;
  if (!keys?.length) return item;
  let left = { ...keyValues(item), frame:0 };
  for (const right of keys) {
    if (right.frame === frame) return { ...item, ...right };
    if (right.frame > frame) {
      const t = (frame - left.frame) / (right.frame - left.frame);
      return { ...item, ...left, position:left.position.map((v,i) => mix(v,right.position[i],t)),
        rotation:left.rotation.map((v,i) => wrapAngle(v + wrapAngle(right.rotation[i]-v)*t)),
        ...(item.type === "actor" && { scale:mix(left.scale,right.scale,t) }),
        ...(item.type === "camera" && { fov:mix(left.fov,right.fov,t) }) };
    }
    left = right;
  }
  return { ...item, ...left };
}
export function sampleStage(stage, frame) {
  const cut = stage.animation?.cuts?.findLast(c => c.frame <= frame);
  return { ...stage, cameraId: cut?.cameraId || stage.cameraId, objects: stage.objects.map(o => {
    const sampled = sampleObject(o,frame);
    const gait = o.type === "actor" && gaitAt(o,frame,stageFps);
    if (!gait) return sampled;
    return { ...sampled,gait,rotation:gait.yaw == null ? sampled.rotation : [sampled.rotation[0],gait.yaw,sampled.rotation[2]] };
  }) };
}
function insert(sorted = [], key) {
  return [...sorted.filter(k => k.frame !== key.frame), key].sort((a,b) => a.frame - b.frame);
}
export function keyObject(stage, id, frame, change = {}) {
  return { ...stage, objects:stage.objects.map(item => {
    if (item.id !== id) return item;
    const values = keyValues({ ...sampleObject(item,frame), ...change });
    return { ...item, keys:insert(item.keys, { ...item.keys?.find(k => k.frame === frame), ...values, frame }) };
  }) };
}
export function cutCamera(stage, cameraId, frame) {
  return { ...stage, animation:{ endFrame:endFrameOf(stage), cuts:insert(stage.animation?.cuts, { frame,cameraId }) } };
}
// A null destination deletes the marker. Moving onto an occupied frame leaves both markers intact.
export function moveMarker(stage, track, from, to) {
  function move(keys = []) {
    const key = keys.find(k => k.frame === from);
    if (!key || (to !== null && keys.some(k => k.frame === to))) return keys;
    const rest = keys.filter(k => k.frame !== from);
    return to === null ? rest : insert(rest,{ ...key,frame:to });
  }
  if (track === "cuts") return { ...stage, animation:{ endFrame:endFrameOf(stage), cuts:move(stage.animation?.cuts) } };
  return { ...stage, objects:stage.objects.map(o => o.id === track ? { ...o,keys:move(o.keys) } : o) };
}
export function validMarkers(keys, end, check) {
  return Array.isArray(keys) && keys.length <= end + 1 &&
    keys.every((k,i) => k && Number.isInteger(k.frame) && k.frame >= 0 && k.frame <= end &&
      (!i || k.frame > keys[i-1].frame) && check(k));
}

export function walkTo(stage, id, start, point, speed = 1.35) {
  const actor = stage.objects.find(o => o.type === "actor" && o.id === id);
  if (!actor || !Number.isInteger(start) || start < 0 || !Number.isFinite(speed) || speed <= 0) throw Error("请选择角色和走位起点");
  if (!point.every(v => Number.isFinite(v) && Math.abs(v)<=100)) throw Error("落点超出场景范围");
  const first = keyValues(sampleObject(actor,start));
  const dx = point[0]-first.position[0], dz = point[2]-first.position[2];
  const distance = Math.hypot(dx,dz);
  if (distance < .05) throw Error("请在离角色稍远的地面设置落点");
  const end = start + Math.max(2,Math.round(distance*stageFps/(speed*first.scale)));
  if (end > maxEndFrame) throw Error("这段走位超过 120 秒，请缩短距离");
  if (actor.keys?.some(k => k.frame > start && k.frame <= end)) throw Error("这段时间已有角色关键帧，请从上一段终点继续或换一个时间");
  const heading = Math.atan2(dx,dz)*180/Math.PI;
  const keys = insert(insert(actor.keys,{...first,pose:"standing",frame:start,facePath:true}),
    {...first,pose:"standing",position:[point[0],first.position[1],point[2]],rotation:[0,heading,0],frame:end});
  return {end,stage:{...stage,animation:{cuts:[],...stage.animation,endFrame:Math.max(endFrameOf(stage),end)},
    objects:stage.objects.map(o => o.id === id ? {...o,keys} : o)}};
}
