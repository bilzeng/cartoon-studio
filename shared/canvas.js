import { seriesPrompt } from "./series.js";
import {
  h3ContinuationFields, h3ContinuationModelId, h3ContinuationPrompt, usesH3Prompt,
} from "./h3-video.js";
import { isImageRestoreModel } from "./image-restore.js";
import { poseOutfitGalleryTag, poseSwapModelId, poseSwapRoles } from "./pose-swap.js";
import { makeNode } from "./studio.js";

import { canvasGroups, removeCanvasNodes, upstreamNodes } from "./canvasGroups.js";

export function canvasInputs(board, node, assets) {
  const upstream = upstreamNodes(board, node.id);
  const images = new Set(
    assets.filter((a) => a.kind === "image").map((a) => a.id),
  );
  const guides = upstream.filter(
    (n) =>
      ["image", "shot"].includes(n.data.kind) && images.has(n.data.assetId),
  );
  const chosen = node.data.canvasRef;
  const reference =
    chosen === "none"
      ? ""
      : chosen === "upload"
        ? node.data.guideAssetId
        : guides.find((n) => n.id === chosen)?.data.assetId ||
          guides[0]?.data.assetId ||
          node.data.guideAssetId ||
          "";
  const awaitingImage =
    !reference &&
    chosen !== "none" &&
    upstream.some((n) => n.data.kind === "image" && !n.data.assetId);
  // A group supplies selectable assets. Only a direct link adds a node’s text to the prompt.
  const direct = new Set(
    board.edges.filter((e) => e.target === node.id).map((e) => e.source),
  );
  const textNodes = upstream.filter(
    (n) =>
      direct.has(n.id) &&
      ["text", "script", "shot"].includes(n.data.kind) &&
      n.data.text.trim(),
  );
  const words = textNodes.map((n) => n.data.title + "：" + n.data.text.trim());
  const speech = textNodes
    .filter((n) => n.data.kind !== "shot")
    .map((n) => n.data.text.trim());
  const text = canvasText(words, node.data, reference, node.data.text);
  return {
    upstream,
    words,
    speech,
    series: board.series,
    guides,
    directGuideIds: guides.filter((n) => direct.has(n.id)).map((n) => n.id),
    awaitingImage,
    reference,
    text,
    prompt: seriesPrompt(board.series, text),
  };
}

function canvasText(words, data, markAssetId, description) {
  const mark = data.imageMark;
  const annotation =
    mark?.assetId === markAssetId && mark?.note?.trim()
      ? "参考图标记（从左向右 " +
        mark.x +
        "%，从上向下 " +
        mark.y +
        "%）：" +
        mark.note.trim()
      : "";
  return [...words, annotation, data.styleHint, description]
    .filter((s) => s?.trim())
    .join("\n");
}

export function addCanvasNode(board, node, anchor, side) {
  if (board.nodes.length >= 250) throw Error("每张画布最多 250 个节点");
  if (
    anchor &&
    !board.nodes.some((n) => n.id === anchor) &&
    !(side === "source" && canvasGroups(board.nodes).has(anchor))
  )
    throw Error("连接起点已移除");
  if (anchor && board.edges.length >= 1000) throw Error("画布连线已达上限");
  const source = side === "target" ? node.id : anchor;
  const target = side === "target" ? anchor : node.id;
  return {
    ...board,
    nodes: [...board.nodes, node],
    edges: anchor
      ? [...board.edges, { id: crypto.randomUUID(), source, target }]
      : board.edges,
    order: node.data.kind === "shot" ? [...board.order, node.id] : board.order,
  };
}

export function addCanvasReferences(board, target, assets) {
  if (board.nodes.length + assets.length > 250 || board.edges.length + assets.length > 1000)
    throw Error("素材已入库，参考节点数超出当前画布上限");
  const x = target.position.x - 460;
  let y = target.position.y - ((assets.length - 1) * 245) / 2;
  const references = [];
  for (const asset of assets) {
    while (board.nodes.some((node) =>
      Math.abs(node.position.x - x) < 365 && Math.abs(node.position.y - y) < 235))
      y += 245;
    const node = makeNode(asset.kind, { x, y }, {
      assetId: asset.id, title: asset.name.slice(0, 120),
    });
    board = addCanvasNode(board, node, target.id, "target");
    references.push(node);
    y += 245;
  }
  return { board, references };
}

export function assignPoseSwapReference(board, targetId, role, { asset, id = "", both }, assets) {
  const target = board.nodes.find((n) => n.id === targetId);
  if (target?.data.imageModel !== poseSwapModelId) throw Error("请重新打开 PoseSwap 节点");
  const roles = both && role !== "person" ? ["pose", "outfit"] : [role];
  const slots = { ...target.data.poseSwapRefs };
  const previous = new Set(roles.map((key) => slots[key]).filter(Boolean));
  const protectedSources = new Set(Object.entries(slots)
    .filter(([key]) => !roles.includes(key)).map(([, source]) => source));
  const replaceable = board.nodes.filter((node) => {
    if (!previous.has(node.id) || protectedSources.has(node.id)) return false;
    const data = node.data;
    const existing = assets.find((item) => item.id === data.assetId);
    const owned = data.poseSwapOwnerId
      ? data.poseSwapOwnerId === targetId
      : existing?.importTags?.includes(poseOutfitGalleryTag);
    if (!owned || data.kind !== "image" || data.canvasGroup || data.text ||
        data.imageModel || data.pendingCanvasJob || data.guideAssetId || data.imageMark ||
        data.title !== existing?.name.slice(0, 120)) return false;
    const connections = board.edges.filter((e) => e.source === node.id || e.target === node.id);
    return connections.length === 1 && connections[0].source === node.id && connections[0].target === targetId;
  });
  let source = id;
  if (asset) {
    source = upstreamNodes(board, targetId).find((n) =>
      ["image", "shot"].includes(n.data.kind) && n.data.assetId === asset.id)?.id;
    if (!source) {
      const slot = replaceable.find((n) => n.id === slots[role]) || replaceable[0];
      if (slot) {
        source = slot.id;
        board = { ...board, nodes: board.nodes.map((n) => n.id === source ? {
          ...n, data: { ...n.data, assetId: asset.id, title: asset.name.slice(0, 120), poseSwapOwnerId: targetId },
        } : n) };
      } else {
        const placed = addCanvasReferences(board, target, [asset]);
        source = placed.references[0].id;
        board = { ...placed.board, nodes: placed.board.nodes.map((n) => n.id === source
          ? { ...n, data: { ...n.data, poseSwapOwnerId: targetId } } : n) };
      }
    }
  }
  for (const key of roles) slots[key] = source;
  const obsolete = replaceable.filter((n) => n.id !== source).map((n) => n.id);
  if (obsolete.length) board = removeCanvasNodes(board, obsolete);
  const assigned = new Set(Object.values(slots));
  return {
    ...board,
    edges: source ? board.edges.filter((e) =>
      e.target !== targetId || !previous.has(e.source) || assigned.has(e.source)) : board.edges,
    nodes: board.nodes.map((n) => n.id === targetId
      ? { ...n, data: { ...n.data, poseSwapRefs: slots } } : n),
  };
}

export function settleCanvasJobs(board, finished) {
  return {
    ...board,
    nodes: board.nodes.map((n) => {
      const job = finished.get(n.data.pendingCanvasJob);
      if (!job || job.nodeId !== n.id) return n;
      const {
        pendingCanvasJob,
        pendingMediaSource,
        pendingImageSource,
        ...data
      } = n.data;
      const previous = pendingMediaSource ?? pendingImageSource;
      // An explicit version change made while generating takes precedence.
      const showResult =
        !data.assetId ||
        (previous !== undefined
          ? previous === data.assetId
          : data.kind === "image");
      if (showResult && job.status === "done" && job.assetId)
        data.assetId = job.assetId;
      return { ...n, data };
    }),
  };
}

// A mention keeps its number even if another source is disconnected or renamed.
export function imageReferences(inputs, node, assets) {
  const sourceIds = [...(node.data.imageRefOrder || [])];
  const refs = inputs.guides.map((n) => ({
    id: n.id,
    title: n.data.title,
    assetId: n.data.assetId,
  }));
  if (
    node.data.guideAssetId &&
    assets.some((a) => a.id === node.data.guideAssetId)
  )
    refs.push({
      id: "upload",
      title: "上传的参考图",
      assetId: node.data.guideAssetId,
    });
  for (const ref of refs) {
    if (!sourceIds.includes(ref.id)) sourceIds.push(ref.id);
    ref.number = sourceIds.indexOf(ref.id) + 1;
    ref.asset = assets.find((a) => a.id === ref.assetId);
  }
  return { sourceIds, refs };
}
export function referenceToken(model, kind, number) {
  const pattern = kind === "image"
    ? model?.mentionPattern || (model?.family === "qwen21" ? "<image{n}>" : "图{n}")
    : model?.mentionPatterns?.[kind] || (kind === "video" ? "视频{n}" : "语音{n}");
  return pattern.replaceAll("{n}", String(number));
}

export function resolveImages(inputs, node, assets, model) {
  const { refs, sourceIds } = imageReferences(inputs, node, assets);
  const tokens = [
    ...new Set(
      Array.from(node.data.text.matchAll(/@图(\d+)/gu), (m) => Number(m[1])),
    ),
  ];
  const chosen = node.data.canvasRef;
  const max = model?.maxRefs ?? (model?.reference ? 1 : 0);
  const multiVideo = model?.kind === "video" && max > 1;
  const manual = multiVideo && Array.isArray(node.data.canvasRefIds)
    ? node.data.canvasRefIds
    : null;
  const mentioned = tokens.sort((a, b) => a - b)
    .map((n) => refs.find((ref) => ref.number === n));
  let selected = mentioned.length
    ? mentioned
    : chosen === "none"
      ? []
      : chosen
        ? refs.filter((r) => r.id === chosen)
        : refs;
  if (manual && chosen !== "none") {
    selected = [...mentioned, ...manual
      .filter((id) => !mentioned.some((ref) => ref?.id === id))
      .map((id) => refs.find((ref) => ref.id === id))];
  } else if (multiVideo && !tokens.length && !chosen && refs.length > max) {
    // A connected cast group may supply more options than one generation can use.
    selected = refs.filter((r) => r.id === "upload" || inputs.directGuideIds?.includes(r.id));
  }
  let error = "";
  if (tokens.length && chosen === "none")
    error = "提示词含有图片引用，请在参数中启用参考图";
  else if (
    selected.some((r) => !r) ||
    (chosen && chosen !== "none" && !tokens.length && !selected.length)
  )
    error = "引用图片已断开，请重新连接或移除对应引用";
  else if (selected.length > max)
    error = max
      ? "此模型最多接收 " + max + " 张图，请用 @ 指定本次参考图或更换模型"
      : "当前模型只接收文字，请在参数中选择仅使用文字或更换模型";
  if (!error && selected.length < (model?.minRefs || 0))
    error = max > model.minRefs
      ? "请选择 " + model.minRefs + " 至 " + max + " 张参考图"
      : "此工作流需要 " + model.minRefs + " 张参考图";
  const description = node.data.text.replace(/@图(\d+)/gu, (token, n) => {
    const i = selected.findIndex((r) => r?.number === Number(n));
    return i < 0 ? token : referenceToken(model, "image", i + 1);
  });
  const markAsset = selected.find(
    (ref) => ref?.assetId === node.data.imageMark?.assetId,
  )?.assetId;
  // An H3 production prompt already incorporates the upstream scene. Keep its
  // opening alignment line and field order intact on generation and re-optimization.
  const formattedH3 = usesH3Prompt(model)
    && /^(?:subject_definitions|integrated_multimodal_description):/m.test(description);
  const prompt = formattedH3 ? description : seriesPrompt(
    inputs.series,
    canvasText(inputs.words, node.data, markAsset, description),
  );
  return { refs, sourceIds, selected: selected.filter(Boolean), prompt, error };
}

export function resolveVideoInputs(inputs, node, assets, model) {
  if (model?.workflow) return resolveImages(inputs, node, assets, model);
  if (/@图\d+/u.test(node.data.text))
    return resolveImages(inputs, node, assets, {
      reference: !!model?.needsImage,
      maxRefs: model?.needsImage ? 1 : 0,
    });
  const { refs, sourceIds } = imageReferences(inputs, node, assets);
  const first =
    model?.needsImage && refs.find((r) => r.assetId === inputs.reference);
  return {
    refs,
    sourceIds,
    selected: first ? [first] : [],
    prompt: inputs.prompt,
    error: "",
  };
}

export function mediaReferenceError(text) {
  const match = text.match(/@(视频|语音)\d+/u);
  return match
    ? "当前工作流没有" + match[1] + "参考输入，请移除提示词中的对应引用。"
    : "";
}

export function availableStyles(model, values = {}) {
  if (
    model?.styleBaseFields?.some((f) => (values[f.key] ?? f.value) !== f.value)
  )
    return [];
  return model?.loras || [];
}

export function canvasMediaRefs(resolved, inputs, data, assets) {
  const refs = [...resolved.refs],
    orders = {};
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const kind of ["video", "audio"]) {
    const ids = [...(data.mediaRefOrder?.[kind] || [])];
    for (const n of inputs.upstream) {
      const asset = byId.get(n.data.assetId);
      if (asset?.kind !== kind) continue;
      if (!ids.includes(n.id)) ids.push(n.id);
      refs.push({
        id: n.id,
        title: n.data.title,
        assetId: asset.id,
        number: ids.indexOf(n.id) + 1,
        asset,
      });
    }
    orders[kind] = ids;
  }
  return { ...resolved, refs, orders };
}

export function resolveWorkflowInputs(inputs, node, assets, model) {
  if (model.id === poseSwapModelId) {
    const { refs, sourceIds } = imageReferences(inputs, node, assets);
    const chosen = node.data.poseSwapRefs || {};
    const unassigned = refs.filter((ref) => ref.id !== chosen.pose && ref.id !== chosen.outfit &&
      !ref.asset?.importTags?.includes(poseOutfitGalleryTag));
    const defaultPerson = unassigned.length === 1 ? unassigned[0].id : "";
    const roles = Object.fromEntries(Object.keys(poseSwapRoles).map((role) => {
      const id = chosen[role] ?? (role === "person" ? defaultPerson : "");
      return [role, refs.find((ref) => ref.id === id)];
    }));
    const selected = Object.values(roles).filter(Boolean);
    const broken = Object.keys(roles).find((role) => chosen[role] && !roles[role]);
    const error = broken ? poseSwapRoles[broken] + "参考图已断开，请重新选择"
      : !roles.person ? "请选择人物或模特参考图"
      : !roles.pose && !roles.outfit ? "请至少添加一张姿势或服装参考图"
      : node.data.text.trim().length > 2000 ? "补充要求最多 2000 字"
      : "";
    return {
      refs, sourceIds, selected, roles, prompt: node.data.text.trim(), error,
      media: { image: selected.map((ref) => ref.asset), video: [], audio: [] },
    };
  }
  if (isImageRestoreModel(model.id)) {
    const source = { ...node, data: { ...node.data, text: "" } };
    const resolved = resolveImages(inputs, source, assets, model);
    return {
      ...resolved,
      error: resolved.selected.length > 1 ? "请选择一张要修复的原图" : resolved.error,
      prompt: "",
      media: { image: resolved.selected.map((r) => r.asset), video: [], audio: [] },
    };
  }
  const imageNode =
    !model.maxRefs && !/@图\d+/.test(node.data.text)
      ? { ...node, data: { ...node.data, canvasRef: "none" } }
      : node;
  const resolved = resolveImages(inputs, imageNode, assets, model);
  const { refs } = canvasMediaRefs(resolved, inputs, node.data, assets);
  const media = {
    image: resolved.selected.map((r) => r.asset),
    video: [],
    audio: [],
  };
  let description = node.data.text;
  const mediaReferences = {};
  for (const [kind, label] of [
    ["video", "视频"],
    ["audio", "语音"],
  ]) {
    const slots = model.mediaSlots?.[kind] || 0;
    const pattern = new RegExp("@" + label + "(\\d+)", "gu");
    const tokens = [
      ...new Set(
        Array.from(description.matchAll(pattern), (m) => Number(m[1])),
      ),
    ].sort((a, b) => a - b);
    const candidates = refs.filter((r) => r.asset.kind === kind);
    const mentioned = tokens.map((n) => candidates.find((r) => r.number === n));
    const optional = !!model.optionalMedia?.[kind];
    const manual = optional && node.data.selectedMediaRefs?.[kind];
    const used = Array.isArray(manual)
      ? [...mentioned, ...manual.filter((id) => !mentioned.some((r) => r?.id === id))
          .map((id) => candidates.find((r) => r.id === id))]
      : tokens.length ? mentioned : slots ? candidates : [];
    if (!resolved.error) {
      if (used.some((r) => !r))
        resolved.error = label + "引用已断开，请重新选择";
      else if (optional && used.length > slots)
        resolved.error = "此模型最多接收 " + slots + " 段" + label + "，请在生成设置中调整";
      else if (!optional && used.length !== slots)
        resolved.error = slots
          ? "此预设需要 " + slots + " 个" + label + "素材，请上传或用 @ 指定"
          : "此预设没有" + label + "输入";
    }
    const selected = used.filter(Boolean);
    mediaReferences[kind] = { candidates, selected, tokens };
    media[kind] = selected.map((r) => r.asset);
    description = description.replace(pattern, (token, n) => {
      const idx = used.findIndex((r) => r?.number === Number(n));
      return idx < 0
        ? token
        : referenceToken(model, kind, idx + 1);
    });
  }
  if (description !== node.data.text)
    resolved.prompt = resolveImages(
      inputs,
      { ...imageNode, data: { ...imageNode.data, text: description } },
      assets,
      model,
    ).prompt;
  if (model.verbatim) {
    resolved.prompt = [...inputs.speech, description.trim()]
      .filter(Boolean)
      .join("\n");
  }
  if (model.id === h3ContinuationModelId) {
    const second = h3ContinuationPrompt(
      node.data.workflowValues?.[h3ContinuationFields.secondPrompt],
      resolved.selected[0],
    );
    return {
      ...resolved, media, mediaReferences, secondPrompt: second.text,
      error: resolved.error || second.error || "",
    };
  }
  return { ...resolved, media, mediaReferences };
}
export function workflowNeeds(model) {
  if (model.id === poseSwapModelId) return "人物图 + 姿势或服装参考";
  return (
    [
      model.hasPrompt !== false && "提示词",
      ...Object.entries(model.mediaSlots || { image: model.minRefs })
        .filter(([, n]) => n > 0)
        .map(
          ([kind, n]) =>
            (kind === "image" && model.minRefs > 0 && model.minRefs < n
              ? model.minRefs + "–" + n : n) +
            { image: " 张图", video: " 段视频", audio: " 段音频" }[kind] +
            ((kind === "image" && model.minRefs === 0) || model.optionalMedia?.[kind] ? "（可选）" : ""),
        ),
    ]
      .filter(Boolean)
      .join(" + ") || "使用预设参数"
  );
}
