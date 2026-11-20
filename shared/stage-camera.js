import { endFrameOf, keyValues, maxEndFrame, sampleObject } from "./stage-animation.js";
import { maxStageFov, minStageFov } from "./stage-lens.js";

export const cameraMoves = {
  push:"推近", pull:"拉远", truckRight:"向右横移", truckLeft:"向左横移",
  arcPush:"弧线推近", dollyZoom:"推轨变焦（希区柯克）", sTravel:"S 形穿行", craneOrbit:"升降环绕",
  rise:"升镜", descend:"降镜", orbitRight:"向右绕拍", orbitLeft:"向左绕拍", pan:"水平摇镜",
};
export const cameraEasings = { linear:"匀速", smooth:"缓入缓出", easeIn:"逐渐加速", easeOut:"逐渐减速" };
export function cameraProgress(t, mode) {
  if (mode === "smooth") return t*t*(3-2*t);
  if (mode === "easeIn") return t*t;
  if (mode === "easeOut") return 1-(1-t)*(1-t);
  return t;
}
const rad = degrees => degrees*Math.PI/180;
const tidy = n => Math.round(n*10000)/10000 || 0;
const angle = n => ((n+180)%360+360)%360-180;
export const isOrbit = move => move === "orbitRight" || move === "orbitLeft" || move === "craneOrbit";
export const usesAngle = move => isOrbit(move) || move === "pan";

// Plan a move from the sampled shot and add ordinary, editable camera keys.
export function addCameraMove(stage, id, { move, start, frames, amount, targetId, easing = "linear" }) {
  const camera = stage.objects.find(o => o.id === id && o.type === "camera");
  const end = start + frames;
  if (!camera || !Object.hasOwn(cameraMoves,move)) throw Error("请选择机位和运镜方式");
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(frames) || frames < 1 || end > maxEndFrame)
    throw Error("运镜时长需至少一帧，结束时间不能超过 120 秒");
  if (!Number.isFinite(amount) || amount <= 0 || amount > (usesAngle(move) ? 180 : 100))
    throw Error(usesAngle(move) ? "角度范围为 0 至 180 度，不含 0" : "距离范围为 0 至 100 米，不含 0");
  if (camera.keys?.some(k => k.frame > start && k.frame <= end))
    throw Error("这段轨道已有关键帧，请移到空白时段或缩短运镜");
  const first = sampleObject(camera,start);
  const [pitch,yaw] = first.rotation.map(rad);
  const forward = [-Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch)];
  const side = [Math.cos(yaw),0,-Math.sin(yaw)];
  const subject = stage.objects.find(o => o.id === targetId && o.type !== "camera");
  const pivot = f => subject ? sampleObject(subject,f).position : first.position.map((p,i) => p+4*forward[i]);
  const fromPivot = first.position.map((p,i) => p-pivot(start)[i]);
  if (isOrbit(move) && Math.hypot(fromPivot[0],fromPivot[2]) < .03) throw Error("绕拍机位与主体需要有水平距离");
  const curved = move === "arcPush" || move === "sTravel";
  function subjectDepth(frame, position) {
    const center = [...pivot(frame)];
    if (subject?.type === "actor") {
      const actor = sampleObject(subject,frame);
      center[1] += actor.scale*(actor.pose === "seated" ? .8 : 1.2);
    }
    return forward.reduce((sum,d,j) => sum+d*(center[j]-position[j]),0);
  }
  const initialDepth = move === "dollyZoom" ? subjectDepth(start,first.position) : 0;
  const segments = Math.min(frames,Math.max(isOrbit(move) ? Math.ceil(amount/8) : 1, curved || move === "dollyZoom" ? 16 : 1, easing !== "linear" ? 12 : 1));
  const keys = [];
  for (let i=0;i<=segments;i++) {
    const frame = start + Math.round(i*frames/segments);
    const t = cameraProgress((frame-start)/frames,easing);
    const travel = amount*t;
    const values = keyValues(first);
    if (isOrbit(move)) {
      const degrees = move === "orbitLeft" ? -travel : travel;
      const a = rad(degrees), center = pivot(frame);
      values.position = [center[0]+fromPivot[0]*Math.cos(a)+fromPivot[2]*Math.sin(a),
        center[1]+fromPivot[1],center[2]+fromPivot[2]*Math.cos(a)-fromPivot[0]*Math.sin(a)];
      values.rotation[1] = angle(first.rotation[1]+degrees);
      if (move === "craneOrbit") {
        const radius = Math.hypot(fromPivot[0],fromPivot[2]);
        const lift = radius*.35*t;
        values.position[1] += lift;
        values.rotation[0] = angle(first.rotation[0]-Math.atan2(lift,radius)*180/Math.PI);
      }
    } else if (move === "dollyZoom") {
      values.position = first.position.map((p,j) => p+travel*forward[j]);
      const depth = subjectDepth(frame,values.position);
      if (Math.min(initialDepth,depth) <= .04) throw Error("变焦主体需要在镜头前方，请减小推进距离或调整机位");
      values.fov = 2*Math.atan(Math.tan(rad(first.fov)/2)*initialDepth/depth)*180/Math.PI;
      if (values.fov < minStageFov || values.fov > maxStageFov) throw Error("变焦超出机位视角范围，请减小推进距离");
    } else if (curved) {
      // A quarter-arc into the shot, or a travelling shot that crosses its centreline.
      const depth = move === "arcPush" ? Math.sin(t*Math.PI/2) : t;
      const lateral = move === "arcPush" ? .65*(1-Math.cos(t*Math.PI/2)) : .22*Math.sin(t*2*Math.PI);
      values.position = first.position.map((p,j) => p + amount*(forward[j]*depth + side[j]*lateral));
    } else if (move === "pan") values.rotation[1] = angle(first.rotation[1]-travel);
    else {
      const axis = ["rise","descend"].includes(move) ? [0,1,0] : move.startsWith("truck") ? side : forward;
      const distance = ["pull","truckLeft","descend"].includes(move) ? -travel : travel;
      values.position = first.position.map((p,j) => p+distance*axis[j]);
    }
    if (values.position.some(p => Math.abs(p)>100.00001)) throw Error("运镜轨迹超出场景边界，请减小幅度");
    if (i === 0) { keys.push({...keyValues(first),frame}); continue; }
    keys.push({...values,position:values.position.map(tidy),rotation:values.rotation.map(tidy),frame});
  }
  const track = [...(camera.keys || []).filter(k => k.frame !== start),...keys].sort((a,b) => a.frame-b.frame);
  return {...stage, animation:{ cuts:[],...stage.animation,endFrame:Math.max(endFrameOf(stage),end) },
    objects:stage.objects.map(o => o.id === id ? {...o,keys:track} : o)};
}
