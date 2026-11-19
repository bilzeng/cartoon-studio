export const ratios = {
  "16:9": { image: [768, 432], video: [512, 288], output: [1280, 720] },
  "9:16": { image: [432, 768], video: [288, 512], output: [720, 1280] },
  "1:1": { image: [576, 576], video: [384, 384], output: [720, 720] },
};
export const defaultSeries = {
  style: "",
  cast: "",
  world: "",
  refAssetId: "",
  ratio: "16:9",
};
export function seriesPrompt(series, shot, shotCast = "") {
  return [
    [series.style, "画风"],
    [shotCast.trim() || series.cast, "角色设定"],
    [series.world, "世界与场景"],
  ]
    .filter(([text]) => text?.trim())
    .map(([text, label]) => label + "：" + text.trim())
    .concat(shot.trim())
    .join("\n");
}
