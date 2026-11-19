// Native ComfyUI nodes, with actual filenames supplied by the connected server.
const node = (class_type, inputs) => ({ class_type, inputs });
export const zImageId = "studio:z-image-turbo";
export function matchSplitModels(folders) {
  const file = (group, pattern) =>
    folders[group]?.find((name) => pattern.test(name.split(/[/\\]/).at(-1)));
  const recipe = (model, clip, vae) =>
    model && clip && vae ? { model, clip, vae } : null;
  return {
    zImage: recipe(
      file(
        "diffusion_models",
        /^z_image_turbo(?:_(?:fp32|fp16|bf16))?\.safetensors$/i,
      ),
      file(
        "text_encoders",
        /^qwen3_4b(?:_(?:bf16|fp16|fp32))?\.safetensors$/i,
      ),
      file("vae", /^ae\.safetensors$/i),
    ),
    wan: recipe(
      file(
        "diffusion_models",
        /^wan2\.1_t2v_1\.3b(?:_(?:bf16|fp16|fp32))?\.safetensors$/i,
      ),
      file(
        "text_encoders",
        /^umt5_xxl(?:_(?:bf16|fp16|fp32|fp8_e4m3fn_scaled))?\.safetensors$/i,
      ),
      file(
        "vae",
        /^wan_?2\.1_vae(?:_(?:bf16|fp16|fp32))?\.(?:safetensors|pth)$/i,
      ),
    ),
  };
}
function loaders(files, type) {
  return {
    1: node("UNETLoader", { unet_name: files.model, weight_dtype: "default" }),
    2: node("CLIPLoader", { clip_name: files.clip, type, device: "default" }),
    3: node("VAELoader", { vae_name: files.vae }),
    4: node("CLIPTextEncode", { clip: ["2", 0], text: "{{prompt}}" }),
  };
}
export function zImageGraph(files, width, height, useReference = false) {
  const graph = {
    ...loaders(files, "lumina2"),
    5: node("ConditioningZeroOut", { conditioning: ["4", 0] }),
    6: node("ModelSamplingAuraFlow", { model: ["1", 0], shift: 3 }),
    7: node("EmptySD3LatentImage", { width, height, batch_size: 1 }),
    8: node("KSampler", {
      model: ["6", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: ["7", 0],
      steps: 8,
      cfg: 1,
      seed: "{{seed}}",
      sampler_name: "res_multistep",
      scheduler: "simple",
      denoise: useReference ? 0.7 : 1,
    }),
    9: node("VAEDecode", { samples: ["8", 0], vae: ["3", 0] }),
    10: node("SaveImage", {
      images: ["9", 0],
      filename_prefix: "CartoonStudio/frame",
    }),
  };
  if (useReference) {
    graph["11"] = node("LoadImage", { image: "{{image}}" });
    graph["12"] = node("ImageScale", {
      image: ["11", 0],
      upscale_method: "lanczos",
      width,
      height,
      crop: "center",
    });
    graph["7"] = node("VAEEncode", { pixels: ["12", 0], vae: ["3", 0] });
  }
  return graph;
}
export function wanGraph(files) {
  return {
    ...loaders(files, "wan"),
    5: node("CLIPTextEncode", {
      clip: ["2", 0],
      text: "blurry, freeze frame, text, watermark, malformed hands",
    }),
    6: node("ModelSamplingSD3", { model: ["1", 0], shift: 8 }),
    7: node("EmptyHunyuanLatentVideo", {
      width: "{{width}}",
      height: "{{height}}",
      length: "{{frames}}",
      batch_size: 1,
    }),
    8: node("KSampler", {
      model: ["6", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: ["7", 0],
      seed: "{{seed}}",
      steps: 16,
      cfg: 6,
      sampler_name: "uni_pc",
      scheduler: "simple",
      denoise: 1,
    }),
    9: node("VAEDecode", { samples: ["8", 0], vae: ["3", 0] }),
    10: node("VHS_VideoCombine", {
      images: ["9", 0],
      frame_rate: 16,
      loop_count: 0,
      filename_prefix: "CartoonStudio/motion",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 19,
      pingpong: false,
      save_output: true,
      save_metadata: false,
    }),
  };
}
