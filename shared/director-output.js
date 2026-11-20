import { addCanvasNode } from "./canvas.js";
import { upstreamNodes } from "./canvasGroups.js";
import { makeNode } from "./studio.js";

export function stageOutputPosition(board, node) {
  const x = node.position.x + 460;
  let y = node.position.y;
  while (board.nodes.some(n => Math.abs(n.position.x-x)<365 && Math.abs(n.position.y-y)<235)) y += 246;
  return {x,y};
}
export function checkVideoDestination(board,stageId,target) {
  if (!board.nodes.some(n => n.id === stageId && n.data.kind === "stage")) throw Error("导演台已移除");
  if (target !== "new" && target !== "only" && !board.nodes.some(n => n.id === target && n.data.kind === "video"))
    throw Error("目标视频节点已移除，请重新选择");
  if (board.nodes.length+(target === "new" ? 2 : 1)>250 || board.edges.length+(target === "only" ? 1 : 2)>1000)
    throw Error("画布节点或连线已达上限");
}
export function placeStageVideo(board,stageId,asset,target,modelId) {
  checkVideoDestination(board,stageId,target);
  const stage = board.nodes.find(n => n.id === stageId);
  const clip = makeNode("video",stageOutputPosition(board,stage),{title:stage.data.title.slice(0,100)+" · 走位预演",assetId:asset.id});
  let next = addCanvasNode(board,clip,stageId,"source");
  if (target === "new") {
    const node = makeNode("video",stageOutputPosition(next,clip),{title:"视频生成",text:"@视频1",...(modelId && {videoModel:modelId}),
      mediaRefOrder:{video:[clip.id]},selectedMediaRefs:{video:[clip.id]}});
    next = addCanvasNode(next,node,clip.id,"source");
  } else if (target !== "only") {
    const existing = board.nodes.find(n => n.id === target);
    const prior = upstreamNodes(board,target).filter(n => n.data.kind === "video" && n.data.assetId).map(n => n.id);
    const order = [...new Set([...(existing.data.mediaRefOrder?.video || []),...prior,clip.id])];
    const token = "@视频"+(order.indexOf(clip.id)+1);
    const text = /@视频\d+/u.test(existing.data.text) ? existing.data.text.trimEnd()+" "+token : existing.data.text;
    if (text.length > 40000) throw Error("视频节点的提示词过长，请缩短后再接入参考");
    const selected = [...new Set([...(existing.data.selectedMediaRefs?.video || prior),clip.id])];
    next = {...next,edges:[...next.edges,{id:crypto.randomUUID(),source:clip.id,target}],
      nodes:next.nodes.map(n => n.id !== target ? n : {...n,data:{...n.data,text,
        mediaRefOrder:{...n.data.mediaRefOrder,video:order},selectedMediaRefs:{...n.data.selectedMediaRefs,video:selected}}})};
  }
  return {board:next,clip};
}
