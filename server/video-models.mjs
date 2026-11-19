import { h3Fields, h3VideoModelId } from "../shared/h3-video.js";
import { bundledPresets } from "./presets/catalog.mjs";

const source = bundledPresets.find((p) => p.id === h3VideoModelId);
const basename = (file) => file.split(/[/\\]/).at(-1);
const find = (files, pattern) => files.find((f) => pattern.test(basename(f)));
const node = (class_type, inputs) => ({ class_type, inputs });

export function videoStyleFiles(files, family) {
  return files.filter((file) => {
    const name = basename(file);
    // Acceleration adapters belong to the sampler schedule, not the style stack.
    if (/turbo|lightning|lightx2v|(?:^|[_-])[48][_-]?step/i.test(name))
      return false;
    return family === "h3"
      ? /(?:^|[/\\])(?:minimax[-_ ]?h3|h3)[/\\_.-]/i.test(file)
      : family === "wan22" &&
          /wan[-_ ]?2[._]2/i.test(file) &&
          /(?:ti2v|5b)/i.test(file);
  });
}

function h3Model(file, inventory) {
  const graph = structuredClone(source.graph);
  // Base models generate at native resolution. The separate 2K preset adds RelayVSR.
  for (const id of Object.keys(graph)) if (+id >= 200) delete graph[id];
  graph.out = structuredClone(source.graph["214"]);
  graph.out.inputs.video = ["130", 0];
  graph.out.inputs.filename_prefix = "CartoonStudio/H3";
  graph.out._meta = { title: "保存原生分辨率 MP4" };
  const clip = find(
    inventory.text_encoders,
    /qwen3vl[_-]32b[_-]minimax[_-]h3/i,
  );
  if (clip) graph["128"].inputs.clip_name = clip;
  graph["127"].inputs.unet_name = file;
  const firstFrame = !/ref2va/i.test(basename(file));
  if (firstFrame) {
    const input = graph["136"].inputs;
    graph["136"] = node("MiniMaxH3ImageToVideo", {
      clip: input.clip,
      vae: input.vae,
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      length: input.length,
      first_frame: ["137", 0],
    });
    graph["140"].inputs.lora_name =
      find(inventory.loras, /h3.*fl2v.*turbo.*8step/i) ||
      "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors";
    graph["147"].inputs.lora_name =
      find(inventory.loras, /h3.*fl2v.*turbo.*4step/i) ||
      "minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors";
  }
  return {
    name: firstFrame
      ? "H3 FL2VA · 首帧生视频"
      : /hybrid/i.test(basename(file))
        ? "H3 Hybrid · 参考图生视频"
        : /singularity/i.test(basename(file))
          ? "H3 Singularity · 参考图生视频"
          : "H3 REF2VA · 参考图生视频",
    family: "h3",
    graph,
    bindings: {
      ...source.bindings,
      output: "out",
      fixedSeeds: false,
      outputSize: [1344, 768],
      mentionPattern: firstFrame ? "图{n}" : "<Picture {n}>",
    },
  };
}

function wanModel(file, inventory) {
  const graph = {
    model: node("UNETLoader", { unet_name: file, weight_dtype: "default" }),
    clip: node("CLIPLoader", {
      clip_name:
        find(inventory.text_encoders, /^umt5_xxl/i) ||
        "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      type: "wan",
      device: "default",
    }),
    vae: node("VAELoader", {
      vae_name:
        find(inventory.vae, /^wan[_-]?2\.2[_-]vae/i) ||
        "wan2.2_vae.safetensors",
    }),
    image: node("LoadImage", { image: "start.png" }),
    positive: node("CLIPTextEncode", { clip: ["clip", 0], text: "" }),
    negative: node("CLIPTextEncode", { clip: ["clip", 0], text: "" }),
    duration: node("PrimitiveFloat", { value: 5 }),
    frames: node("ComfyMathExpression", {
      expression: "4 * round(a * 24 / 4) + 1",
      "values.a": ["duration", 0],
    }),
    latent: node("Wan22ImageToVideoLatent", {
      vae: ["vae", 0],
      width: 1280,
      height: 704,
      batch_size: 1,
      length: ["frames", 1],
      start_image: ["image", 0],
    }),
    shift: node("ModelSamplingSD3", { model: ["model", 0], shift: 8 }),
    sample: node("KSampler", {
      model: ["shift", 0],
      positive: ["positive", 0],
      negative: ["negative", 0],
      latent_image: ["latent", 0],
      seed: 0,
      steps: 20,
      cfg: 5,
      sampler_name: "uni_pc",
      scheduler: "simple",
      denoise: 1,
    }),
    decode: node("VAEDecode", { samples: ["sample", 0], vae: ["vae", 0] }),
    video: node("CreateVideo", { images: ["decode", 0], fps: 24 }),
    out: structuredClone(source.graph["214"]),
  };
  graph.out.inputs.video = ["video", 0];
  graph.out.inputs.filename_prefix = "CartoonStudio/Wan22";
  const durationKey = JSON.stringify(["duration", "value"]);
  return {
    name: "Wan 2.2 TI2V 5B · 文生 / 图生视频",
    family: "wan22",
    durationKey,
    optionalFirstFrame: true,
    graph,
    bindings: {
      kind: "video",
      output: "out",
      outputSize: [1280, 704],
      images: [JSON.stringify(["image", "image"])],
      prompt: JSON.stringify(["positive", "text"]),
      controls: [durationKey],
      styleSource: JSON.stringify(["model", 0]),
    },
  };
}

export function videoModelPresets(inventory) {
  return (inventory?.diffusion_models || []).flatMap((file) => {
    const name = basename(file);
    const recipe = /minimax[-_]h3.*(?:ref2va|fl2va)/i.test(name)
      ? h3Model
      : /wan2[._]2[_-]ti2v[_-]5b/i.test(name)
        ? wanModel
        : null;
    if (!recipe) return [];
    const preset = recipe(file, inventory);
    return [
      {
        ...preset,
        baseModel: file,
        id: "studio:video:" + file,
        durationKey: preset.durationKey || h3Fields.duration,
      },
    ];
  });
}
