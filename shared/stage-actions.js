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
  duelReady: {name:"对峙亮相", category:"武打", angles:{leftHip:15,leftKnee:17,rightKnee:13,torsoTwist:-18,leftArm:40,leftElbow:58,rightArm:30,rightElbow:78}},
  palmFlourish: {name:"掌风亮势", category:"武打", period:34,
    angles:{leftArm:35,leftElbow:65,rightArm:48,rightElbow:73,leftKnee:13,rightKnee:17},
    beats:[[0,{}],[.3,{torsoTwist:-32,rightArm:-24,rightSpread:50}],[.52,{torsoTwist:38,rightArm:55,rightElbow:-62,leftSpread:35}],[1,{}]]},
  shadowFlurry: {name:"连拳剪影", category:"武打", period:34,
    angles:{leftArm:36,rightArm:35,leftElbow:75,rightElbow:75,leftKnee:12,rightKnee:12},
    beats:[[0,{}],[.22,{torsoTwist:-32,leftArm:60,leftElbow:-68}],[.43,{}],[.65,{torsoTwist:35,rightArm:62,rightElbow:-71}],[1,{}]]},
  leapSilhouette: {name:"腾空亮相", category:"武打", period:43,
    angles:{leftArm:25,rightArm:25},
    beats:[[0,{}],[.23,{lift:-.13,torsoLean:20,leftKnee:23,rightKnee:32}],
      [.55,{lift:.38,torsoTwist:35,leftHip:68,leftKnee:56,rightHip:37,rightKnee:44,leftSpread:75,rightSpread:64}],
      [.83,{lift:-.09,leftKnee:40,rightKnee:37,torsoLean:26}],[1,{}]]},
  stuntKick: {name:"腾跃甩腿", category:"武打", period:44,
    angles:{leftArm:28,rightArm:28,leftSpread:16,rightSpread:24},
    beats:[[0,{}],[.23,{torsoLean:23,leftKnee:30,rightKnee:29,lift:-.08}],
      [.51,{lift:.31,torsoTwist:52,torsoLean:-24,leftHip:86,leftKnee:22,rightHip:30,rightKnee:57,leftSpread:52,rightSpread:70}],
      [.84,{leftKnee:30,rightKnee:30,lift:-.07}],[1,{}]]},
  highWhipKick: {name:"高鞭腿", category:"武打", period:54,
    angles:{leftArm:35,rightArm:38,leftElbow:56,rightElbow:70},
    beats:[
      [0,{}],
      [.21,{leftHip:63,leftKnee:81,leftHipTurn:70,leftHipSpread:18,torsoTwist:-30,torsoLean:12}],
      [.4,{leftHip:152,leftKnee:10,leftHipTurn:56,leftHipSpread:18,torsoTwist:35,torsoLean:-20,leftSpread:57,rightSpread:32}],
      [.53,{leftHip:135,leftKnee:10,leftHipTurn:-12,torsoTwist:49,torsoLean:-22,leftSpread:64,rightSpread:36}],
      [.73,{leftHip:56,leftKnee:66,leftHipTurn:-12,torsoTwist:19,leftSpread:17}],
      [1,{}],
    ]},
  wingChun: {name:"咏春拳", category:"武打", period:42,
    angles:{leftArm:39,rightArm:39,leftElbow:76,rightElbow:76,leftSpread:-14,rightSpread:-14},
    beats:[
      [0,{}],
      [.17,{rightArm:47,rightElbow:-71,leftArm:-16,rightSpread:9,torsoTwist:9}],
      [.28,{}],
      [.4,{leftArm:46,leftElbow:-71,rightArm:-17,leftSpread:8,torsoTwist:-9}],
      [.53,{}],
      [.67,{rightArm:46,rightElbow:-69,leftArm:-11,rightSpread:8,torsoTwist:8}],
      [.78,{}],
      [.89,{leftArm:33,leftElbow:-58,leftSpread:5,torsoTwist:-5}],
      [1,{}],
    ]},
  dragonPalms: {name:"降龙十八掌", category:"武打", period:76,
    angles:{leftArm:30,rightArm:30,leftElbow:66,rightElbow:66,leftSpread:-12,rightSpread:-12},
    beats:[
      [0,{}],
      [.15,{leftSpread:66,rightSpread:66,leftArm:0,rightArm:0,torsoLean:-12}],
      [.28,{leftArm:78,rightArm:78,leftSpread:42,rightSpread:42,leftElbow:-39,rightElbow:-39,headTilt:18}],
      [.42,{leftArm:55,rightArm:57,leftElbow:-57,rightElbow:-57,leftSpread:19,rightSpread:19,torsoLean:22}],
      [.57,{leftArm:34,rightArm:38,leftElbow:-32,rightElbow:-32,leftSpread:43,rightSpread:58,torsoLean:15,torsoTwist:26}],
      [.77,{leftSpread:22,rightSpread:32,leftElbow:-12,rightElbow:-6,torsoTwist:-13}],
      [1,{}],
    ]},
  sweepingDodge: {name:"转身闪避", category:"武打", period:36,
    angles:{leftElbow:56,rightElbow:58,leftArm:36,rightArm:36},
    beats:[[0,{}],[.32,{torsoLean:37,torsoTwist:-46,leftKnee:32,rightKnee:35,lift:-.12}],
      [.63,{torsoTwist:42,leftSpread:48,rightSpread:29,headTurn:-30}],[1,{}]]},
  stuntRecoil: {name:"受击踉跄", category:"武打", period:46,
    beats:[[0,{}],[.22,{torsoLean:-37,torsoTwist:29,headTilt:21,leftSpread:56,rightSpread:61,rightHip:-28}],
      [.65,{torsoLean:35,leftHip:14,rightKnee:47,rightArm:73,lift:-.11}],[1,{}]]},
  swordFlourish: {name:"剑花收势", category:"武打", period:44,
    angles:{rightArm:43,rightElbow:58,leftArm:24,leftElbow:40},
    beats:[[0,{}],[.24,{rightArm:92,rightSpread:44,torsoTwist:-30,rightElbow:22}],
      [.55,{rightArm:40,rightSpread:-38,rightElbow:-36,torsoTwist:36,leftSpread:49}],[1,{}]]},
  bladeArc: {name:"刀光回旋", category:"武打", period:46,
    angles:{leftArm:25,rightArm:48,rightElbow:47,rightSpread:26},
    beats:[[0,{}],[.30,{torsoTwist:-50,rightArm:88,rightSpread:55,rightElbow:12}],
      [.61,{torsoTwist:58,rightArm:-27,rightSpread:-62,rightElbow:-26,leftSpread:38}],[1,{}]]},
  staffFlourish: {name:"棍影轮转", category:"武打", period:48,
    angles:{leftArm:51,rightArm:58,leftElbow:65,rightElbow:54},
    beats:[[0,{}],[.28,{torsoTwist:-37,rightArm:54,rightSpread:53,leftArm:-17}],
      [.59,{torsoTwist:39,rightSpread:-42,rightElbow:-34,leftArm:35,leftSpread:20}],[1,{}]]},
  shieldStunt: {name:"举盾格挡", category:"武打", period:36,
    angles:{leftArm:56,leftElbow:57,rightArm:23,rightElbow:56},
    beats:[[0,{}],[.37,{leftArm:27,leftSpread:17,torsoLean:-20,rightKnee:38,lift:-.07}],
      [.62,{torsoLean:14,torsoTwist:-24,leftElbow:-12,leftSpread:25}],[1,{}]]},
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
export function actionAngles(pose, phase = 0) {
  const action = actionPresets[pose];
  const rest = action?.angles || {};
  if (!action?.beats) return rest;
  const time = Math.min(1, Math.max(0, phase));
  const index = action.beats.findIndex(([at]) => at > time);
  if (index < 1) return rest;
  const [start, first] = action.beats[index - 1];
  const [end, next] = action.beats[index];
  const blend = (time - start) / (end - start);
  const offsets = blendJoints(first, next, blend * blend * (3 - 2 * blend));
  return Object.fromEntries([...new Set([...Object.keys(rest), ...Object.keys(offsets)])]
    .map((id) => [id, (rest[id] || 0) + (offsets[id] || 0)]));
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
