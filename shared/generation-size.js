import { ratios } from "./series.js";
export const videoUpscale2kId = "studio:preset:video-upscale-2k";
export const defaultMaxSide = 4096;
export function outputSize(kind, ratio, custom) {
  return custom ? [custom.width, custom.height] : ratios[ratio][kind];
}
export function sizeError(size, maxSide, constraints) {
  for (const [index, value] of size.entries()) {
    const spec = constraints?.[index] || {};
    const max = Math.min(maxSide, spec.max || Infinity);
    const min = spec.min || 8,
      step = spec.step || 8;
    if (
      !Number.isInteger(value) ||
      value < min ||
      value > max ||
      value % step !== 0
    )
      return (
        (index ? "高度" : "宽度") +
        "须在 " +
        min +
        " 到 " +
        max +
        " 像素之间，且为 " +
        step +
        " 的倍数"
      );
  }
  return "";
}
