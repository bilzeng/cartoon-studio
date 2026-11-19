import {
  defaultRedrawStrength, redrawStrengthKey, restoreSizeKey, secondPassRestoreId,
} from "../../shared/image-restore.js";

const node = (class_type, inputs) => ({ class_type, inputs });
// Krea2 needs an aligned latent. Resize the full frame for sampling, then restore its exact dimensions.
const alignedDimension = (axis) => node("ComfyMathExpression", {
  expression: "max(32, ((a + 8) // 16) * 16)", "values.a": ["dimensions", axis],
});
const tiles = { tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 };

export const secondPassRestore = {
  id: secondPassRestoreId,
  name: "高清修复 · 二采放大（Krea2）",
  graph: {
    source: node("LoadImage", { image: "source.png" }),
    size: node("ImageScaleToMaxDimension", {
      image: ["source", 0], upscale_method: "bicubic", largest_size: 2560,
    }),
    dimensions: node("GetImageSize", { image: ["size", 0] }),
    width: alignedDimension(0),
    height: alignedDimension(1),
    aligned: node("ImageScale", {
      image: ["size", 0], width: ["width", 1], height: ["height", 1],
      upscale_method: "bicubic", crop: "disabled",
    }),
    model: node("UNETLoader", { unet_name: "krea2_turbo_bf16.safetensors", weight_dtype: "default" }),
    clip: node("CLIPLoader", { clip_name: "qwen3vl_4b_bf16.safetensors", type: "krea2", device: "default" }),
    vae: node("VAELoader", { vae_name: "qwen_image_vae.safetensors" }),
    positive: node("CLIPTextEncode", {
      clip: ["clip", 0],
      text: "Faithful restoration of the original image. Preserve identity, expression, composition, lighting and depth of field. Natural fine textures, smooth tonal transitions and soft clean shadows.",
    }),
    negative: node("ConditioningZeroOut", { conditioning: ["positive", 0] }),
    encode: node("VAEEncodeTiled", { pixels: ["aligned", 0], vae: ["vae", 0], ...tiles }),
    sample: node("KSampler", {
      model: ["model", 0], positive: ["positive", 0], negative: ["negative", 0],
      latent_image: ["encode", 0], steps: 8, seed: 0, cfg: 1,
      sampler_name: "euler", scheduler: "simple", denoise: defaultRedrawStrength,
    }),
    decode: node("VAEDecodeTiled", { samples: ["sample", 0], vae: ["vae", 0], ...tiles }),
    result: node("ImageScale", {
      image: ["decode", 0], width: ["dimensions", 0], height: ["dimensions", 1],
      upscale_method: "bicubic", crop: "disabled",
    }),
    out: node("SaveImage", { images: ["result", 0], filename_prefix: "CartoonStudio/SecondPass" }),
  },
  bindings: {
    kind: "image", output: "out", prompt: "",
    images: [JSON.stringify(["source", "image"])], controls: [restoreSizeKey, redrawStrengthKey],
  },
};
