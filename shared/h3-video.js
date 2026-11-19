export const h3VideoModelId = "studio:preset:h3-2k";
export const h3ContinuationModelId = "studio:preset:h3-continuation";
export const h3ContinuationFields = {
  firstDuration: JSON.stringify(["first", "seconds"]),
  secondDuration: JSON.stringify(["second", "seconds"]),
  secondPrompt: JSON.stringify(["second", "prompt"]),
  aspect: JSON.stringify(["settings", "aspect_ratio"]),
  resolution: JSON.stringify(["settings", "resolution"]),
};
export const h3Fields = {
  fast: JSON.stringify(["146", "value"]),
  landscape: JSON.stringify(["160", "value"]),
  duration: JSON.stringify(["165", "value"]),
};

export function usesH3Prompt(model) {
  return model?.family === "h3" ||
    model?.id === h3VideoModelId ||
    model?.id === h3ContinuationModelId;
}

export function h3ContinuationSizeError(resolution, aspect, maxSide) {
  const megapixels = {
    "360P": 0.2, "416P": 0.3, "480P": 0.4, "540P": 0.5, "640P": 0.7,
    "720P": 0.9, "768P": 1, "832P": 1.2, "928P": 1.5, "1024P": 1.8, "1080P": 2,
  }[resolution];
  const [width, height] = String(aspect).split(":").map(Number);
  if (!megapixels || !width || !height) return "当前工作流的分辨率或画幅不受支持";
  // The AICG3D resolution buckets specify an area, aligned to H3's 32 px grid.
  const longest = Math.max(width, height) * Math.sqrt(megapixels * 1024 ** 2 / (width * height));
  return Math.round(longest / 32) * 32 > maxSide
    ? "两段续接的输出超过当前环境的最长边上限"
    : "";
}

export function h3ContinuationPrompt(value, reference) {
  const text = (typeof value === "string" ? value.trim() : "").replace(/@图(\d+)/gu, (tag, n) =>
    Number(n) === reference?.number ? "<Picture 1>" : tag);
  if (!text) return { error: "请填写第二段的接续动作" };
  if (text.length > 8000) return { error: "第二段的提示词不能超过 8000 字" };
  if (
    /@(图|视频|语音)\d+/u.test(text) ||
    Array.from(text.matchAll(/<(Picture|Video|Audio)\s+(\d+)>/gi)).some(
      ([, kind, number]) => kind.toLowerCase() !== "picture" || number !== "1",
    )
  ) return { error: "第二段只能引用两段共用的参考图" };
  return { text };
}
