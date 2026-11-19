import { availableStyles } from "../shared/canvas.js";
import { zImageGraph, zImageId } from "./recipes.mjs";
import { fail } from "./storage.mjs";
const basename = (name) => name.split(/[/\\]/).at(-1);
function family(name) {
  const parts = name.toLowerCase().split(/[/\\]/);
  for (const part of parts) {
    if (/^krea[-_ ]?2(?:$|[^0-9])/.test(part)) return "krea2";
    if (/^(?:qwen[-_ ]?image[-_ ]?2[._]1|qi2\.1)(?:$|[^0-9])/.test(part))
      return "qwen21";
    if (/^z[-_ ]?image(?:$|[^a-z])/.test(part)) return "zImage";
  }
  return "";
}
export function imageCatalog(inventory, zImage, capabilities) {
  const { diffusion_models, text_encoders, vae, loras } = inventory;
  const catalog = [];
  function add(familyId, files, id, name, vaes, maxRefs) {
    catalog.push({
      family: familyId,
      ...files,
      id,
      name,
      vaes,
      maxRefs,
      reference: maxRefs > 0,
      loras: capabilities.lora
        ? loras.filter((file) => family(file) === familyId)
        : [],
    });
  }
  if (zImage) add("zImage", zImage, zImageId, "Z-Image Turbo", [zImage.vae], 1);
  for (const model of diffusion_models) {
    const f = family(model),
      krea = f === "krea2";
    if (
      !(krea || f === "qwen21") ||
      (krea ? !capabilities.kreaClip : !capabilities.qwen)
    )
      continue;
    const clip = text_encoders.find((n) =>
      (krea ? /qwen3vl[_-]4b/i : /qwen3vl[_-]8b/i).test(basename(n)),
    );
    const vaes = vae.filter((n) =>
      krea
        ? /(?:^|[/\\])(?:krea2RealVae[^/\\]*|qwen_image_vae)\.safetensors$/i.test(
            n,
          )
        : /qwen_image_2[._]1_vae/i.test(basename(n)),
    );
    if (!clip || !vaes.length) continue;
    const defaultVae =
      (krea && vaes.find((n) => /qwen_image_vae/i.test(n))) || vaes[0];
    add(
      f,
      { model, clip, vae: defaultVae },
      "studio:unet:" + model,
      basename(model).replace(/\.safetensors$/i, ""),
      vaes,
      krea ? (capabilities.kreaEdit ? 2 : 0) : capabilities.qwenRefs,
    );
  }
  return catalog;
}
export function selectedLoras(model, data) {
  const loras = data.imageLoras || [];
  if (
    loras.some(
      (l) =>
        !availableStyles(model, data.workflowValues).includes(l.name) ||
        !Number.isFinite(l.strength) ||
        l.strength < 0 ||
        l.strength > 2,
    )
  )
    throw fail("所选 LoRA 与当前模型或环境不匹配，请重新选择风格");
  return loras;
}
export function imageOptions(model, data) {
  const vae = data.imageVae || model?.vae;
  if (data.imageVae && !model?.vaes?.includes(vae))
    throw fail("当前环境缺少所选 VAE，请重新选择");
  return { vae, loras: selectedLoras(model, data) };
}
const node = (class_type, inputs) => ({ class_type, inputs });
export function buildImageGraph(model, options, width, height, count) {
  if (count > model.maxRefs) throw fail("参考图数量超出当前模型的上限");
  const files = { ...model, vae: options.vae };
  const graph = zImageGraph(
    files,
    width,
    height,
    model.family === "zImage" && count > 0,
  );
  let source = ["1", 0];
  for (const [i, lora] of options.loras.entries()) {
    const id = String(40 + i);
    graph[id] = node("LoraLoaderModelOnly", {
      model: source,
      lora_name: lora.name,
      strength_model: lora.strength,
    });
    source = [id, 0];
  }
  if (model.family === "zImage") {
    graph[6].inputs.model = source;
    return graph;
  }
  const krea = model.family === "krea2";
  graph[2].inputs.type = krea ? "krea2" : "qwen_image";
  delete graph[6];
  graph[7] = node(krea && count ? "EmptySD3LatentImage" : "EmptyLatentImage", {
    width,
    height,
    batch_size: 1,
  });
  Object.assign(graph[8].inputs, {
    model: source,
    steps: krea ? (count ? 10 : 8) : 25,
    sampler_name: "euler",
  });
  if (!krea) {
    graph[4] = node("TextEncodeQwenImage21", {
      clip: ["2", 0],
      vae: ["3", 0],
      prompt: "{{prompt}}",
      negative_prompt: "",
      resolution: 768,
    });
    delete graph[5];
    graph[8].inputs.negative = ["4", 1];
    const accelerator = options.loras.find(
      (l) => /viggle.*(?:4|6)step/i.test(l.name) && l.strength > 0,
    );
    if (accelerator)
      graph[8].inputs.steps = /4step/i.test(accelerator.name) ? 4 : 6;
  } else if (count) {
    graph[4] = node("Krea2EditGroundedEncode", {
      clip: ["2", 0],
      prompt: "{{prompt}}",
      grounding_px: 768,
    });
    graph[5] = node("Krea2EditGroundedEncode", {
      clip: ["2", 0],
      prompt: "",
      grounding_px: 768,
    });
    graph[6] = node("Krea2EditModelPatch", {
      model: source,
      vae: ["3", 0],
      target_latent: ["7", 0],
      fit_mode: "fit",
    });
    graph[8].inputs.model = ["6", 0];
  }
  for (let i = 0; i < count; i++) {
    const key = String(100 + 3 * i),
      image = [key, 0];
    graph[key] = node("LoadImage", { image: "{{image" + (i + 1) + "}}" });
    if (!krea) {
      graph[4].inputs["images.image_" + (i + 1)] = image;
      continue;
    }
    const scale = String(101 + 3 * i),
      latent = String(102 + 3 * i),
      suffix = i ? "_b" : "";
    graph[scale] = node("ImageScaleToTotalPixels", {
      image,
      upscale_method: "lanczos",
      megapixels: 0.5,
      resolution_steps: 8,
    });
    graph[latent] = node("VAEEncode", { pixels: [scale, 0], vae: ["3", 0] });
    for (const id of [4, 5]) graph[id].inputs["image" + suffix] = [scale, 0];
    graph[6].inputs["source_image" + suffix] = [scale, 0];
    graph[6].inputs["source_latent" + suffix] = [latent, 0];
  }
  return graph;
}
