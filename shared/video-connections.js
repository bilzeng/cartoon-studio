import { canvasInputs, canvasMediaRefs, imageReferences } from "./canvas.js";

// Keep mention numbers and an author's explicit selection when wiring another reference.
export function attachVideoInput(board,targetId,sourceId,assets,models) {
  const node = board.nodes.find(n => n.id === targetId);
  if (node?.data.kind !== "video" || models.find(m => m.id === node.data.videoModel)?.hasPrompt === false) return board;
  const inputs = canvasInputs(board,node,assets);
  const images = imageReferences(inputs,node,assets);
  const {refs,orders} = canvasMediaRefs(images,inputs,node.data,assets);
  const incoming = refs.find(ref => ref.id === sourceId);
  if (!incoming) return board;
  const kind = incoming.asset.kind;
  const data = {...node.data,imageRefOrder:images.sourceIds,mediaRefOrder:orders};
  if (kind === "image") {
    if (data.canvasRef || data.canvasRefIds) {
      const prior = data.canvasRefIds || (data.canvasRef && data.canvasRef!=="none" ? [data.canvasRef] : []);
      data.canvasRefIds = [...new Set([...prior,sourceId])];
      data.canvasRef = "";
    }
  } else if (data.selectedMediaRefs?.[kind]) {
    data.selectedMediaRefs = {...data.selectedMediaRefs,[kind]:[...new Set([...data.selectedMediaRefs[kind],sourceId])]};
  }
  const prefix = {image:"图",video:"视频",audio:"语音"}[kind];
  const mentioned = new Set(Array.from(data.text.matchAll(new RegExp("@"+prefix+"(\\d+)","gu")),m => Number(m[1])));
  if (!mentioned.has(incoming.number)) {
    const manual = kind === "image" ? data.canvasRefIds : data.selectedMediaRefs?.[kind];
    const use = mentioned.size ? [incoming] : refs.filter(r => r.asset.kind === kind && (!manual || manual.includes(r.id)));
    const text = [data.text.trimEnd(),...use.map(r => "@"+prefix+r.number)].filter(Boolean).join(" ");
    if (text.length<=40000) data.text = text;
  }
  if (!data.videoModel) {
    const counts = {image:0,video:0,audio:0};
    for (const ref of refs) counts[ref.asset.kind]++;
    const model = models.find(m => m.hasPrompt!==false && !m.framePair && (m.minRefs || 0)<=counts.image &&
      !(m.dependencies || []).some(f => !f.choices.includes(f.value)) &&
      Object.entries(counts).every(([k,n]) => {
        const slots = k==="image" ? (m.maxRefs ?? Number(!!m.needsImage)) : (m.mediaSlots?.[k] || 0);
        return slots>=n && (k==="image" || !slots || !!m.optionalMedia?.[k] || slots===n);
      }));
    if (model) data.videoModel=model.id;
  }
  return {...board,nodes:board.nodes.map(n => n.id === targetId ? {...n,data} : n)};
}

// Replace a source in its existing numbered slot, including after earlier disconnections.
export function replaceVideoSource(board, edgeId, source, assets) {
  const edge = board.edges.find(e => e.id === edgeId);
  const node = edge && board.nodes.find(n => n.id === edge.target);
  if (node?.data.kind !== "video" || source === edge.target || board.edges.some(e => e.target === edge.target && e.source === source)) return board;
  const byNode = new Map(board.nodes.map(n => [n.id,n.data.assetId]));
  const assetKinds = new Map(assets.map(a => [a.id,a.kind]));
  const kind = assetKinds.get(byNode.get(edge.source));
  if (!kind || kind !== assetKinds.get(byNode.get(source))) return board;
  const inputs = canvasInputs(board,node,assets);
  const images = imageReferences(inputs,node,assets);
  const {orders} = canvasMediaRefs(images,inputs,node.data,assets);
  const order = kind === "image" ? images.sourceIds : orders[kind];
  const oldIndex = order.indexOf(edge.source), occupied = order.indexOf(source);
  if (oldIndex < 0) return board;
  const swap = ids => ids?.map(id => id === edge.source ? source : id);
  const data = {...node.data};
  // A previously mentioned source can already own a slot. Preserve all the other numbers.
  const updated = occupied < 0 ? swap(order) : order;
  if (occupied >= 0) {
    const prefix = {image:"图",video:"视频",audio:"语音"}[kind];
    data.text = data.text.replace(new RegExp("@"+prefix+(oldIndex+1)+"(?!\\d)","gu"),"@"+prefix+(occupied+1));
  }
  if (kind === "image") {
    data.imageRefOrder = updated;
    if (data.canvasRef === edge.source) data.canvasRef = source;
    if (data.canvasRefIds) data.canvasRefIds = [...new Set(swap(data.canvasRefIds))];
  } else {
    data.mediaRefOrder = {...data.mediaRefOrder,[kind]:updated};
    if (data.selectedMediaRefs?.[kind]) data.selectedMediaRefs = {...data.selectedMediaRefs,[kind]:[...new Set(swap(data.selectedMediaRefs[kind]))]};
  }
  return {...board,edges:board.edges.map(e => e.id===edge.id ? {...e,source} : e),
    nodes:board.nodes.map(n => n.id===node.id ? {...n,data} : n)};
}
