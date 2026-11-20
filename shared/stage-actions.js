// Angles are offsets from each preset, in degrees. Positive lift moves a limb forward.
export const jointControls = {
  torsoLean: ["躯干前倾", -45, 80], torsoTwist: ["躯干转向", -70, 70],
  headTurn: ["转头", -90, 90], headTilt: ["抬头", -60, 60],
  leftArm: ["左肩前举", -100, 150], rightArm: ["右肩前举", -100, 150],
  leftSpread: ["左臂外展", -60, 150], rightSpread: ["右臂外展", -60, 150],
  leftElbow: ["左肘弯曲", -120, 140], rightElbow: ["右肘弯曲", -120, 140],
  leftHip: ["左腿前举", -70, 100], rightHip: ["右腿前举", -70, 100],
  leftKnee: ["左膝弯曲", -90, 130], rightKnee: ["右膝弯曲", -90, 130],
};

export const actionPresets = {
  standing: {name:"站立", category:"姿态"},
  seated: {name:"坐姿", category:"姿态"},
  crouching: {name:"蹲下", category:"姿态", angles:{leftArm:25,rightArm:25,leftElbow:35,rightElbow:35}},
  kneeling: {name:"双膝跪地", category:"姿态"},
  halfKneel: {name:"单膝跪地", category:"姿态"},
  tPose: {name:"T 字站姿", category:"姿态", angles:{leftSpread:80,rightSpread:80}},
  hips: {name:"叉腰", category:"姿态"},
  folded: {name:"抱臂", category:"姿态", angles:{leftArm:48,rightArm:40,leftSpread:-26,rightSpread:-28,leftElbow:83,rightElbow:93}},
  bowing: {name:"鞠躬", category:"交流", angles:{torsoLean:52,headTilt:-12}},
  reaching: {name:"伸手", category:"交流", angles:{rightArm:74,rightElbow:12}},
  thinking: {name:"思考", category:"交流"},
  walking: {name:"迈步", category:"移动", period:24},
  running: {name:"跑步", category:"移动", period:16, angles:{leftElbow:70,rightElbow:70,torsoLean:16}},
  pointing: {name:"指向", category:"交流"},
  listening: {name:"倾听", category:"交流"},
  waving: {name:"挥手", category:"交流", period:30},
  talking: {name:"交谈", category:"交流", period:48, angles:{leftArm:20,leftElbow:55,rightArm:12,rightElbow:42}},
  nodding: {name:"点头", category:"交流", period:36},
  reading: {name:"看手机", category:"交流", angles:{headTilt:-24,leftArm:25,leftElbow:83,rightArm:21,rightElbow:76,leftSpread:-18,rightSpread:-18}},
};
export const stagePoses = Object.fromEntries(Object.entries(actionPresets).map(([id, action]) => [id,action.name]));
export function validJoints(joints) {
  return joints === undefined || (joints !== null && typeof joints === "object" && !Array.isArray(joints) &&
    Object.entries(joints).every(([id,value]) => Object.hasOwn(jointControls,id) && Number.isFinite(value) &&
      value >= jointControls[id][1] && value <= jointControls[id][2]));
}
export function blendJoints(a = {}, b = {}, t) {
  const result = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    result[id] = (a[id] || 0) * (1-t) + (b[id] || 0) * t;
  }
  return result;
}
export function actionPhase(actor, pose, frame) {
  const period = actionPresets[pose]?.period;
  if (!period) return undefined;
  let start = 0, last = actor.pose;
  for (const key of actor.keys || []) {
    if (key.frame > frame) break;
    if (key.pose !== last) { start = key.frame; last = key.pose; }
  }
  return ((frame-start) % period) / period;
}

export const stageSwitches = {
  labels: ["角色标签", false], grid: ["地面网格", true], snap: ["网格吸附", false],
  floor: ["显示地面", true], rail: ["运动轨迹", true], monitor: ["机位监看", true],
};
export const switchOn = (stage, id) => stage.settings?.[id] ?? stageSwitches[id][1];
