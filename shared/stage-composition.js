import { stageColors, stageFrames, stageObject, stagePoses } from "./director-stage.js";
import { ratios } from "./series.js";
import { makeNode } from "./studio.js";
import { addCanvasNode, addCanvasReferences } from "./canvas.js";
import { castProfiles, crowdProfile } from "./stage-cast.js";

export const formations = { row: "单排", rows: "交错排列", circle: "围成一圈" };

export function formationPoints(pattern, count, spacing) {
  const cols = Math.ceil(Math.sqrt(count * 1.6));
  return Array.from({length:count}, (_, i) => {
    if (pattern === "circle") {
      const angle = 2 * Math.PI * i / count;
      const radius = Math.max(spacing, spacing / (2 * Math.sin(Math.PI / count)));
      return {x:radius * Math.sin(angle), z:radius * Math.cos(angle), yaw:(i * 360 / count + 180) % 360};
    }
    const row = pattern === "row" ? 0 : Math.floor(i / cols);
    const length = pattern === "row" ? count : Math.min(cols,count - row * cols);
    const column = pattern === "row" ? i : i % cols;
    return {x:(column - (length-1)/2 + (row % 2)*.35) * spacing, z:-(row+1)*spacing, yaw:0};
  });
}

export function addFormation(stage, pattern, count, spacing, origin, cast = "mixed") {
  if (!Object.hasOwn(formations,pattern) || !Number.isInteger(count) || count < 2 || count > 24 ||
      stage.objects.length + count > 64 || !Number.isFinite(spacing) || spacing < .6 || spacing > 4 ||
      (cast !== "mixed" && !Object.hasOwn(castProfiles, cast)))
    throw Error("请检查群演人数、间距和剩余对象数量");
  const names = new Set(stage.objects.map(o => o.name));
  let serial = 1;
  const actors = formationPoints(pattern,count,spacing).map(({x,z,yaw},index) => {
    const position = [origin[0]+x, origin[1], origin[2]+z];
    if (position.some(v => Math.abs(v)>100)) throw Error("队形超出场景边界，请缩小间距或调整中心位置");
    while (names.has("群演 "+serial)) serial++;
    return {...stageObject("actor"), name:"群演 "+serial++, position, rotation:[0,yaw,0],
      body: crowdProfile(cast, index), color: stageColors[index % stageColors.length]};
  });
  return {...stage, objects:[...stage.objects,...actors]};
}

export function compositionPlan(stage, subjects, assets, kind) {
  const byId = new Map(assets.filter(a => a.kind === "image").map(a => [a.id,a]));
  const references = [];
  function mention(id) {
    if (!id) return "";
    if (!byId.has(id)) throw Error("参考图已移除，请重新选择");
    if (!references.includes(id)) references.push(id);
    return "@图"+(references.indexOf(id)+2);
  }
  const lines = ["以 @图1 为"+(kind === "video" ? "开场构图" : "构图基准")+"，保持机位、取景、人物在画面中的位置、大小和遮挡关系。"];
  const byActor = new Map(stage.objects.map(o => [o.id,o]));
  for (const {id,x,y} of subjects) {
    const actor = byActor.get(id);
    if (actor?.type !== "actor") continue;
    const ref = mention(actor.referenceAssetId);
    const body = castProfiles[actor.body]?.name || castProfiles.standard.name;
    lines.push(actor.name+"（"+body+"体型，人偶 "+actor.color+"，画面横向 "+x+"%、纵向 "+y+"%，"+stagePoses[actor.pose]+"）"+
      (ref ? "采用 "+ref+" 的人物外貌与服装。" : "按此处的人物姿态和比例塑造。"));
  }
  const background = mention(stage.backgroundId);
  if (background) lines.push("用 "+background+" 还原场景材质和光线，以 @图1 确定可见范围。");
  return {kind, ratio:stage.ratio, text:lines.join("\n"), references:references.map(id => byId.get(id))};
}

export function existingCompositionReferences(board, references) {
  return references.map(asset => board.nodes.find(n => n.data.kind === "image" && n.data.assetId === asset.id));
}

export function placeComposition(board, frame, plan, position, modelId) {
  const [width,height] = stageFrames[plan.ratio];
  const framing = Object.hasOwn(ratios,plan.ratio) ? {canvasRatio:plan.ratio}
    : {canvasRatio:"16:9",customSize:{width,height}};
  const target = makeNode(plan.kind,position,{
    title:plan.kind === "image" ? "构图生图" : "构图生视频",text:plan.text,...framing,
    ...(modelId && {[plan.kind+"Model"]:modelId}),
  });
  const connected = addCanvasNode(board,target,frame.id,"source");
  if (connected.edges.length + plan.references.length > 1000) throw Error("画布连线已达上限");
  const existing = existingCompositionReferences(board,plan.references);
  const linked = {...connected,edges:[...connected.edges,...existing.filter(Boolean).map(n => ({
    id:crypto.randomUUID(),source:n.id,target:target.id,
  }))]};
  const missing = plan.references.filter((_,index) => !existing[index]);
  const {board:next,references} = addCanvasReferences(linked,target,missing);
  const byAsset = new Map([...existing.filter(Boolean),...references].map(n => [n.data.assetId,n.id]));
  const order = [frame.id,...plan.references.map(a => byAsset.get(a.id))];
  return {target,board:{...next,nodes:next.nodes.map(n => n.id === target.id
    ? {...n,data:{...n.data,imageRefOrder:order}} : n)}};
}
