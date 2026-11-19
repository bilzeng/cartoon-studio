import { poseOutfitGalleryTag, poseSwapModelId } from "../../shared/pose-swap.js";

const link = (id, output = 0) => [id, output];
const node = (class_type, inputs, title) => ({
  class_type, inputs, ...(title && { _meta: { title } }),
});
const loadImage = () => node("LoadImage", { image: "reference.png" });
const posePrompt =
  "Repose the same person from <image 2> in the exact pose, camera angle and framing of <image 1>. " +
  "Follow the guide for head direction, hand positions, elbow angles, torso tilt and weight-bearing leg. " +
  "Redraw the body into the guide's pose while preserving the face, hair, clothing and visual style of <image 2>. " +
  "Keep the entire pose visible within the output. Use the environment and light of <image 2> where they fit the new framing.";
const fusionPrompt =
  "Create an image of the same person from <image 2>, in exactly the body pose and camera viewpoint of <image 1>, wearing the complete outfit from <image 3>. " +
  "Follow <image 1> for head direction, arm angles, hand positions, torso tilt, weight-bearing leg and framing. " +
  "Preserve the person's facial identity, hairstyle and visual style from <image 2>; its original gesture, clothes and props are replaced. " +
  "Dress the person in all visible layers of <image 3>. Fit sleeves onto the arms in their new position, with the inner garment underneath the outer layer. " +
  "Include the visible footwear and accessories, placing them naturally on the person. Remove every old clothing layer. " +
  "Keep every body part included in the pose reference within the output framing, including hands and footwear when shown. " +
  "Use the setting and light of <image 2> where they fit the new framing.";
const outfitPrompt =
  "Dress the person in <image 1> in the complete visible outfit from <image 2>. Replace the original clothing layers with the matching top, bottom, outerwear, accessories and footwear. " +
  "Fit sleeves onto the arms and shoes or boots onto both feet exactly as the reference shows. Preserve footwear when <image 2> has none. Match the garment materials, colors and silhouette. " +
  "Keep the identity, hairstyle, pose, camera, background, lighting and style of <image 1>.";
const filenameWithoutExtension = (name) => name?.replace(/\.[a-z]+$/i, "").replace(/[\r\n]+/g, " ").trim().slice(0, 150);

function editStage(stage, picture1, picture2, prompt, steps, cfg) {
  const encode = stage + "-encode", sampler = stage + "-sample";
  return {
    [encode]: node("TextEncodeQwenImage21", {
      clip: link("encoder"), vae: link("vae"), prompt, negative_prompt: "",
      resolution: 768, "images.image_1": picture1, "images.image_2": picture2,
    }),
    [sampler]: node("KSampler", {
      model: link("model"), positive: link(encode), negative: link(encode, 1),
      latent_image: link("latent"), seed: 1, steps, cfg,
      sampler_name: "euler", scheduler: "simple", denoise: 1,
    }, stage === "pose" ? "PoseSwap · 调整姿势" : "PoseSwap · 更换服装"),
    [stage + "-decode"]: node("VAEDecode", { samples: link(sampler), vae: link("vae") }),
  };
}

export const poseSwapPreset = {
  id: poseSwapModelId,
  name: "PoseSwap · 姿势与换装",
  graph: {
    person: loadImage(),
    pose: loadImage(),
    outfit: loadImage(),
    model: node("UNETLoader", { unet_name: "qwen_image_2.1_int8_convrot.safetensors", weight_dtype: "default" }),
    encoder: node("CLIPLoader", { clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "qwen_image", device: "default" }),
    vae: node("VAELoader", { vae_name: "qwen_image_2.1_vae_bf16.safetensors" }),
    latent: node("EmptyLatentImage", { width: "{{width}}", height: "{{height}}", batch_size: 1 }),
    ...editStage("pose", link("pose"), link("person"), posePrompt, 25, 2.5),
    ...editStage("outfit", link("person"), link("outfit"), outfitPrompt, 20, 2.5),
    out: node("SaveImage", { images: link("outfit-decode"), filename_prefix: "CartoonStudio/PoseSwap" }),
  },
  bindings: {
    kind: "image", prompt: "", output: "out",
    images: ["person", "pose", "outfit"].map((role) => JSON.stringify([role, "image"])),
    controls: [],
  },
};

export function bindPoseSwap(config, roles, notes, profile = {}) {
  const { graph } = config;
  const stage = roles.pose ? "pose" : "outfit";
  const encode = graph[stage + "-encode"].inputs;
  if (roles.pose) {
    if (profile.poseModel) graph.model.inputs.unet_name = profile.poseModel;
    if (roles.outfit) {
      encode["images.image_3"] = link("outfit");
      encode.prompt = fusionPrompt;
      graph["pose-sample"]._meta.title = "PoseSwap · 合成人物、姿势与服装";
    }
    const name = filenameWithoutExtension(roles.pose.asset?.name);
    if (name) encode.prompt += "\nPose reference label: " + name + ".";
  } else {
    graph.outfit.inputs.image = "{{image2}}";
  }
  const outfit = roles.outfit?.asset;
  if (outfit?.importTags?.includes(poseOutfitGalleryTag)) {
    const description = filenameWithoutExtension(outfit.name);
    if (description) encode.prompt += "\nGarments named in the reference: " + description + ".";
  }
  if (notes) encode.prompt += "\nAdditional directions: " + notes;
  let model = link("model");
  if (roles.pose && profile.poseLora) {
    graph.poseLora = node("LoraLoaderModelOnly", {
      model, lora_name: profile.poseLora, strength_model: 1,
    }, "PoseSwap · PoseStudio V1.1");
    model = link("poseLora");
  }
  if (profile.cache) {
    graph.modelCache = node("QwenImage21Cache", { model, device: "auto", dtype: "default" });
    model = link("modelCache");
  }
  graph[stage + "-sample"].inputs.model = model;
  graph.out.inputs.images = link(stage + "-decode");
  for (const role of ["pose", "outfit"]) {
    if (!roles[role]) delete graph[role];
    if (role !== stage)
      for (const suffix of ["-encode", "-sample", "-decode"]) delete graph[role + suffix];
  }
  return config;
}
