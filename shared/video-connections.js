import { canvasInputs, canvasMediaRefs, imageReferences, resolveWorkflowInputs } from "./canvas.js";

// New links supply candidates and stable mention numbers.
export function attachVideoInputs(before, board, targetId, assets, models) {
  const node = board.nodes.find((n) => n.id === targetId);
  if (node?.data.kind !== "video") return board;
  let model = models.find((m) => m.id === node.data.videoModel);
  if (model?.hasPrompt === false) return board;
  const inputs = canvasInputs(board, node, assets);
  const images = imageReferences(inputs, node, assets);
  const { refs, orders } = canvasMediaRefs(images, inputs, node.data, assets);
  const priorInputs = canvasInputs(before, node, assets);
  const priorIds = new Set(priorInputs.upstream.map((n) => n.id));
  const added = new Set(refs.filter((r) => r.id !== "upload" && !priorIds.has(r.id)).map((r) => r.asset.kind));
  if (!added.size) return board;
  const data = { ...node.data, imageRefOrder: images.sourceIds, mediaRefOrder: orders };
  if (!data.videoModel) {
    const counts = {image:0,video:0,audio:0};
    for (const ref of refs) counts[ref.asset.kind]++;
    model = models.find(m => m.hasPrompt!==false && !m.framePair && (m.minRefs || 0)<=counts.image &&
      !(m.dependencies || []).some(f => !f.choices.includes(f.value)) &&
      Object.entries(counts).every(([k,n]) => {
        const slots = k==="image" ? (m.maxRefs ?? Number(!!m.needsImage)) : (m.mediaSlots?.[k] || 0);
        return slots>=n && (k==="image" || !slots || !!m.optionalMedia?.[k] || slots===n);
      }));
    if (model) data.videoModel=model.id;
  }
  if (model?.workflow) {
    const pickImages = added.has("image") && model.maxRefs > 1 && !model.minRefs &&
      !data.canvasRef && !Array.isArray(data.canvasRefIds);
    const pickMedia = ["video", "audio"].filter((kind) =>
      added.has(kind) && model.optionalMedia?.[kind] && !Array.isArray(data.selectedMediaRefs?.[kind]),
    );
    if (pickImages || pickMedia.length) {
      // Freeze the previous implicit selection so newly connected optional refs start unchecked.
      const prior = resolveWorkflowInputs(priorInputs, node, assets, model);
      if (pickImages) {
        const mentioned = new Set([...data.text.matchAll(/@图(\d+)/gu)].map((m) => Number(m[1])));
        data.canvasRefIds = prior.selected.filter((r) => !mentioned.has(r.number)).map((r) => r.id);
      }
      for (const kind of pickMedia) {
        const { selected, tokens } = prior.mediaReferences[kind];
        data.selectedMediaRefs = {
          ...data.selectedMediaRefs,
          [kind]: selected.filter((r) => !tokens.includes(r.number)).map((r) => r.id),
        };
      }
    }
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
