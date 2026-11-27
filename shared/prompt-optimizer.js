import { h3ContinuationFields, h3ContinuationModelId, h3Fields, usesH3Prompt } from "./h3-video.js";
import { shotWorkflowValues } from "./storyboard.js";
import { referenceToken } from "./canvas.js";

export const h3ReferenceFields = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music",
];
export const h3BaseFields = [
  "integrated_multimodal_description",
  "overall_soundscape",
  "non_diegetic_music",
];
export const h3Opening =
  "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

export function optimizationContext(data, model, resolved, ratio, { forEditor = false } = {}) {
  const kind = data.kind ?? "video";
  const h3 = kind === "video" && usesH3Prompt(model);
  const values = shotWorkflowValues(data, model);
  const fieldValue = (key) =>
    values?.[key] ??
    model.fields?.find((f) => f.key === key)?.value;
  const requestedDuration =
    fieldValue(model.durationKey || (h3 && h3Fields.duration)) ??
    data.duration ??
    3;
  const duration = model.native
    ? Math.min(5, requestedDuration)
    : requestedDuration;
  const landscape = h3 && fieldValue(h3Fields.landscape);
  let aspect = ratio;
  if (data.customSize)
    aspect = data.customSize.width + "×" + data.customSize.height;
  if (model.outputSize?.length === 2) aspect = model.outputSize.join("×");
  if (h3 && typeof landscape === "boolean")
    aspect = landscape ? "横屏" : "竖屏";
  if (model.id === h3ContinuationModelId)
    aspect = fieldValue(h3ContinuationFields.aspect) || ratio;
  const references = [];
  for (const [medium, label, editorLabel, refs] of [
    ["image", "Picture", "图", resolved.selected],
    ["video", "Video", "视频", resolved.mediaReferences?.video?.selected],
    ["audio", "Audio", "语音", resolved.mediaReferences?.audio?.selected],
  ]) {
    for (const [i, ref] of (refs || []).entries()) {
      references.push({
        label: `<${label} ${i + 1}>`,
        ...(forEditor && !h3
          ? { token: "@" + editorLabel + ref.number }
          : kind !== "video" && { token: referenceToken(model, medium, i + 1) }),
        title: ref.title || ref.asset?.title || "",
        assetId: ref.assetId,
      });
    }
  }
  let mode = "general";
  if (h3) {
    mode = "T2VA";
    if (references.length) {
      const frames =
        model.framePair || /fl2va/i.test(model.baseModel || model.name);
      mode = frames ? (references.length === 2 ? "FL2VA" : "I2VA") : "Ref2VA";
    }
  }
  return {
    // Keep the original video basis so saved drafts still match after an update.
    ...(kind !== "video" && { kind }),
    modelId: model.id || "studio:default-" + kind,
    mode,
    ...(kind === "video" && { duration }),
    ...(kind !== "audio" && { aspect }),
    ...(kind === "audio" && model.verbatim && { verbatim: true }),
    // General models edit the node body. Its upstream context is added at generation.
    scene: forEditor && !h3 ? data.text : resolved.prompt,
    references,
  };
}

export function optimizedNodeChanges(data, context, resolved, text) {
  const changes = { text };
  if (context.mode === "I2VA" || context.mode === "FL2VA") {
    // The mandatory alignment line names frames by upload order, not canvas number.
    const ids = resolved.selected.map((ref) => ref.id);
    changes.canvasRef = ids.length === 1 ? ids[0] : "";
    changes.canvasRefIds = ids;
  } else if (context.mode === "Ref2VA") {
    // Restore explicit editor mentions so a referenced subset stays bound even
    // when the connected group contains other, unselected assets.
    const mentioned = new Set(data.text.match(/@(图|视频|语音)\d+/gu));
    const tokens = new Map();
    for (const [kind, name, refs] of [
      ["Picture", "图", resolved.selected],
      ["Video", "视频", resolved.mediaReferences?.video?.selected],
      ["Audio", "语音", resolved.mediaReferences?.audio?.selected],
    ]) {
      (refs || []).forEach((ref, i) => {
        const token = "@" + name + ref.number;
        if (mentioned.has(token)) tokens.set(`<${kind} ${i + 1}>`, token);
      });
    }
    changes.text = text.replace(/<(?:Picture|Video|Audio) \d+>/g, (token) => tokens.get(token) || token);
  }
  return changes;
}

export function optimizedPromptError(text, context) {
  if (typeof text !== "string" || !text.trim()) return "模型返回了空提示词，请重试";
  if (text.length > 8000) return "优化结果超过 8000 字，请缩短描述后重试";
  if (context.mode === "general") {
    const mentions = (s) => new Set(s.match(/@(图|视频|语音)\d+/gu));
    const source = mentions(context.scene), result = mentions(text);
    for (const token of source)
      if (!result.has(token)) return "优化结果遗漏了素材引用 " + token;
    for (const token of result)
      if (!source.has(token)) return "优化结果新增了素材引用 " + token;
  }
  const labels = new Set(context.references.map((r) => r.token || r.label));
  for (const [label] of text.matchAll(/<(?:Picture|Video|Audio) \d+>/g)) {
    if (!labels.has(label)) return "优化稿引用了未选用的素材 " + label;
  }
  for (const { token } of context.references) {
    if (token && context.scene.includes(token) && !text.includes(token))
      return "优化稿遗漏了原文中的素材引用 " + token;
  }
  if (context.verbatim) {
    const spokenWords = (s) => s.replace(/[\s\p{P}]/gu, "");
    if (spokenWords(text) !== spokenWords(context.scene))
      return "逐字朗读的台词只能调整标点和分段，请保留原词。";
  }
  if (context.mode === "general") return "";
  const fields = context.mode === "Ref2VA" ? h3ReferenceFields : h3BaseFields;
  let previous = -1;
  for (const field of fields) {
    const match = new RegExp("^" + field + ":", "m").exec(text);
    if (!match || match.index <= previous)
      return "请按 H3 格式填写字段 " + field;
    previous = match.index;
  }
  if (context.mode === "Ref2VA") {
    for (const label of labels)
      if (!text.includes(label)) return "优化稿遗漏了本次参考素材 " + label;
  }
  if (context.mode === "I2VA" && !text.trimStart().startsWith(h3Opening))
    return "首帧模式缺少 H3 首帧对齐说明";
  if (context.mode === "FL2VA") {
    const firstLine = text.trimStart().split("\n", 1)[0];
    if (
      !firstLine.startsWith(
        "How the reference pictures align with the target video",
      ) ||
      !firstLine.includes(
        "Picture 1 (from Shot 1) aligns with the 0.00-second mark",
      ) ||
      !firstLine.includes("Picture 2 (from Shot ") ||
      !firstLine.includes(Number(context.duration).toFixed(2) + "-second mark")
    )
      return "请按 H3 格式标明首帧和末帧的对齐时间";
  }
  if (!text.includes("[Shot 1]")) return "优化稿缺少 [Shot 1] 镜头描述";
  for (const [, mm, ss] of text.matchAll(/\bAt (\d\d):(\d\d\.\d{3})/g)) {
    if (Number(mm) * 60 + Number(ss) >= context.duration)
      return "镜头切换时间超出视频时长";
  }
  return "";
}

export function currentOptimization(context, adopted) {
  return adopted?.basis === JSON.stringify(context) && !optimizedPromptError(adopted.text, context);
}

export function effectivePrompt(context, adopted) {
  return currentOptimization(context, adopted) ? adopted.text : context.scene;
}
