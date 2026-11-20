import { bundledPresets } from "./presets/catalog.mjs";
import { videoModelPresets, videoStyleFiles } from "./video-models.mjs";
import { currentUrl } from "./environments.mjs";
import { settings, changeSettings } from "./files.mjs";
import { fail } from "./storage.mjs";
import { makeId } from "../shared/studio.js";
import { isImageRestoreModel, relayRestoreModelId, restoreSizeKey, secondPassRestoreId, redrawStrengthKey, maxRedrawStrength } from "../shared/image-restore.js";
import { isCharacterCard, characterCardId } from "../shared/character-card.js";
import { h3VideoModelId, h3ContinuationModelId, h3ContinuationSizeError } from "../shared/h3-video.js";
import { panoramaModelId, panoramaLoraFile } from "../shared/image-actions.js";
import { poseSwapModelId } from "../shared/pose-swap.js";

export async function savePresetFiles(preset, descriptor, values) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw fail("请重新选择模型文件");
  for (const [key, value] of Object.entries(values))
    if (
      !descriptor.dependencies.some(
        (f) => f.key === key && f.choices.includes(value),
      )
    )
      throw fail("所选文件在当前环境中不可用");
  await changeSettings((state) => {
    const environment = currentUrl();
    let item = state.mappings.find(
      (m) => m.environment === environment && m.preset === preset.id,
    );
    if (!item) {
      item = { environment, preset: preset.id, files: {} };
      state.mappings.push(item);
    }
    Object.assign(item.files, values);
  });
}
export function checkedGraph(input) {
  const graph = input?.prompt || input;
  if (
    !graph ||
    typeof graph !== "object" ||
    Array.isArray(graph) ||
    !Object.keys(graph).length ||
    Object.keys(graph).length > 1000 ||
    Object.values(graph).some(
      (n) =>
        !n ||
        typeof n.class_type !== "string" ||
        !n.inputs ||
        typeof n.inputs !== "object" ||
        Array.isArray(n.inputs),
    )
  )
    throw fail(
      "请选择 ComfyUI 导出的 API 格式 JSON（节点包含 class_type 和 inputs）",
    );
  return graph;
}
export function inspectGraph(graph, definitions) {
  const fields = [],
    images = [],
    videos = [],
    audios = [],
    fileInputs = [],
    outputs = [],
    modelOutputs = [],
    missing = [];
  for (const [id, n] of Object.entries(graph)) {
    const def = definitions[n.class_type];
    if (!def) {
      missing.push(n.class_type);
      continue;
    }
    const schema = { ...def.input?.required, ...def.input?.optional };
    const title = n._meta?.title || def.display_name || n.class_type;
    def.output?.forEach((type, index) => {
      if (type === "MODEL")
        modelOutputs.push({
          key: JSON.stringify([id, index]),
          title: "#" + id + " " + title,
        });
    });
    if (def.output_node) {
      const video =
        /video|VHS_VideoCombine/i.test(n.class_type) ||
        Object.values(schema).some(([type]) => type === "VIDEO");
      outputs.push({
        id,
        title,
        kind: video
          ? "video"
          : /audio/i.test(n.class_type) ||
              Object.values(schema).some(([type]) => type === "AUDIO")
            ? "audio"
            : "image",
      });
    }
    for (const [input, value] of Object.entries(n.inputs)) {
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      )
        continue;
      const spec = schema[input];
      if (!spec) continue;
      const [type, options = {}] = spec;
      const key = JSON.stringify([id, input]),
        field = { key, id, input, title: title + " · " + input, value };
      const choices = Array.isArray(type) ? type : options.options;
      if (
        typeof value === "string" &&
        (type === "STRING" || type === "COMBO" || Array.isArray(type))
      )
        fileInputs.push(field);
      const slot =
        options.video_upload ||
        (/loadvideo/i.test(n.class_type) && /^(video|file)$/.test(input))
          ? videos
          : options.audio_upload ||
              (/loadaudio/i.test(n.class_type) &&
                /^(audio|audio_file|file)$/.test(input))
            ? audios
            : options.image_upload ||
                (n.class_type === "LoadImage" && input === "image")
              ? images
              : null;
      if (slot) {
        slot.push(field);
        continue;
      }
      if (
        Array.isArray(choices) &&
        choices.every((v) => ["string", "number", "boolean"].includes(typeof v))
      )
        fields.push({ ...field, type: "choice", choices });
      else if (["STRING", "FLOAT", "INT", "BOOLEAN"].includes(type))
        fields.push({
          ...field,
          type,
          min: options.min,
          max: options.max,
          step: options.step,
        });
    }
  }
  if (missing.length)
    throw fail("当前环境缺少节点：" + [...new Set(missing)].join("、"));
  const spec = definitions.LoraLoaderModelOnly?.input?.required?.lora_name;
  return {
    fields,
    images,
    videos,
    audios,
    fileInputs,
    outputs,
    modelOutputs,
    loras: (Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options) || [],
  };
}
export function checkBindings(info, bindings) {
  if (
    !bindings ||
    (bindings.prompt !== "" &&
      !info.fields.some(
        (f) => f.key === bindings.prompt && f.type === "STRING",
      ))
  )
    throw fail("请选择接收画布提示词的文字输入");
  if (
    bindings.mentionPattern !== undefined &&
    (typeof bindings.mentionPattern !== "string" ||
      bindings.mentionPattern.length > 80 ||
      !bindings.mentionPattern.includes("{n}"))
  )
    throw fail("引用格式需包含序号占位符 {n}");
  if (
    (bindings.kind && !["image", "video", "audio"].includes(bindings.kind)) ||
    !info.outputs.some((o) => o.id === bindings.output)
  )
    throw fail("请选择对应类型的结果输出节点");
  if (
    bindings.styleSource &&
    !info.modelOutputs.some((m) => m.key === bindings.styleSource)
  )
    throw fail("风格加载器需要连接可用的 MODEL 输出");
  if (
    bindings.styleFiles !== undefined &&
    (!Array.isArray(bindings.styleFiles) ||
      bindings.styleFiles.some((f) => typeof f !== "string"))
  )
    throw fail("LoRA 选择无效");
  if (
    bindings.mentionPatterns &&
    Object.entries(bindings.mentionPatterns).some(
      ([kind, pattern]) =>
        !["audio", "video"].includes(kind) ||
        typeof pattern !== "string" ||
        pattern.length > 80 ||
        !pattern.includes("{n}"),
    )
  )
    throw fail("素材引用格式须包含 {n}");
  const seen = new Set([bindings.prompt]);
  for (const group of ["images", "videos", "audios"]) {
    const slots = bindings[group] ?? [];
    if (!Array.isArray(slots) || slots.length > 64)
      throw fail("素材输入绑定无效");
    for (const key of slots) {
      if (seen.has(key) || !info.fileInputs.some((f) => f.key === key))
        throw fail("素材输入不能重复绑定");
      seen.add(key);
    }
  }
  if (
    bindings.controls &&
    (!Array.isArray(bindings.controls) ||
      bindings.controls.some(
        (key) => !info.fields.some((f) => f.key === key) || seen.has(key),
      ))
  )
    throw fail("工作流参数绑定无效");
}
export async function storePreset(name, graph, bindings) {
  if (typeof name !== "string" || !name.trim() || name.length > 100)
    throw fail("请填写工作流名称");
  const id = "studio:preset:" + makeId();
  await changeSettings((state) =>
    state.presets.push({
      id,
      environment: currentUrl(),
      name: name.trim(),
      graph,
      bindings,
    }),
  );
  return id;
}
export async function readPresets(inventory) {
  const { presets, mappings } = await settings();
  const environment = currentUrl();
  const imported = presets
    .filter((p) => p.environment === environment)
    .sort((a, b) => a.name.localeCompare(b.name));
  const importedIds = new Set(imported.map(p => p.id));
  const builtins = bundledPresets.filter(p => !importedIds.has(p.id));
  return [...imported, ...builtins, ...videoModelPresets(inventory)].map((p) => ({
    ...p,
    fileMap:
      mappings.find((m) => m.preset === p.id && m.environment === environment)
        ?.files || {},
  }));
}
function h3InputRange(optional, group, prefix) {
  const spec = optional?.[group];
  const template = spec?.[1]?.template;
  if (spec?.[0] !== "COMFY_AUTOGROW_V3" || template?.prefix !== prefix ||
      !Number.isSafeInteger(template.max) || template.max < 1) return null;
  return template;
}

const h3FlexRefAdapter = /(?:^|[/\\])pika_h3_flex_ref2va_v1_bf16\.safetensors$/i;
const qwenPoseModel = /(?:^|[/\\])qwen_image_2\.1_bf16\.safetensors$/i;
const qwenPoseAdapter = /(?:^|[/\\])VNCCS_QI2_PoseStudioV1\.1\.safetensors$/i;

export function describePreset(preset, definitions) {
  const { fields, ...info } = inspectGraph(preset.graph, definitions);
  if (preset.id === secondPassRestoreId) {
    const denoise = fields.find(f => f.key === redrawStrengthKey);
    if (denoise) denoise.max = Math.min(denoise.max ?? 1, maxRedrawStrength);
  }
  checkBindings({ ...info, fields }, preset.bindings);
  if (preset.id === secondPassRestoreId &&
      !fields.find(f => f.id === "clip" && f.input === "type")?.choices?.includes("krea2"))
    throw fail("二采放大需要支持 Krea2 的 CLIPLoader");
  const editable = fields.filter(
    (f) =>
      ![
        preset.bindings.prompt,
        ...(preset.bindings.images || []),
        ...(preset.bindings.videos || []),
        ...(preset.bindings.audios || []),
      ].includes(f.key) && !["seed", "noise_seed"].includes(f.input) &&
      !(preset.id === relayRestoreModelId && f.id === "prepare") &&
      !(preset.id === poseSwapModelId && f.id === "latent" && ["width", "height"].includes(f.input)),
  );
  const panorama = preset.id === panoramaModelId;
  const dependencies = editable.filter(
    (f) =>
      f.type === "choice" &&
      !(preset.id === secondPassRestoreId && f.input === "sampler_name") &&
      (f.input === "font_file" || /_name$/.test(f.input) ||
        /\.(safetensors|ckpt|gguf|pth|pt|bin)$/i.test(String(f.value))),
  );
  for (const f of dependencies) {
    const basename = (name) => String(name).split(/[/\\]/).at(-1).toLowerCase();
    const matches = f.choices.filter((v) => basename(v) === basename(f.value));
    f.original = f.value;
    f.value =
      preset.fileMap?.[f.key] ??
      (f.choices.includes(f.value)
        ? f.value
        : matches.length === 1
          ? matches[0]
          : f.value);
    if (panorama && !preset.fileMap?.[f.key] && !f.choices.includes(f.value)) {
      const pattern = {unet_name:/^qwen[-_]image[-_]2[._]1[-_]/i,clip_name:/^qwen3vl[-_]8b[-_]/i,vae_name:/^qwen[-_]image[-_]2[._]1[-_]vae/i}[f.input];
      if (pattern) f.value = f.choices.find(file => pattern.test(basename(file))) ?? f.value;
    }
    if (preset.id === h3VideoModelId && f.id === "128" && !preset.fileMap?.[f.key] && !f.choices.includes(f.value)) {
      const compatible = f.choices.filter(name => /(?:^|[/\\])qwen3vl[_-]32b[_-]minimax[_-]h3[_-]/i.test(name));
      if (compatible.length === 1) f.value = compatible[0];
    }
  }
  const n = preset.bindings.images?.length || 0;
  const poseSwapWeight = preset.id === poseSwapModelId &&
    dependencies.find((f) => f.id === "model" && f.input === "unet_name");
  const poseModel = poseSwapWeight && (preset.fileMap?.[poseSwapWeight.key]
    ? poseSwapWeight.value
    : poseSwapWeight.choices.find((name) => qwenPoseModel.test(name)));
  const poseSwapProfile = poseSwapWeight && {
    cache: !!definitions.QwenImage21Cache,
    poseModel,
    poseLora: qwenPoseModel.test(poseModel) &&
      poseSwapWeight.choices.includes(poseModel)
      ? info.loras.find((name) => qwenPoseAdapter.test(name))
      : undefined,
  };
  const condition = preset.family === "h3" && preset.graph["136"]?.class_type;
  const h3FlexAdapters = condition === "MiniMaxH3ReferenceToVideo"
    ? editable.filter(f => ["140", "147"].includes(f.id) && f.input === "lora_name" && h3FlexRefAdapter.test(f.value))
    : [];
  if (h3FlexAdapters.length && !definitions.ManualSigmas)
    throw fail("H3 Flex 需要 ComfyUI 的 ManualSigmas 节点");
  const optional = definitions[condition]?.input?.optional;
  let maxRefs = n;
  let minRefs = preset.id === poseSwapModelId ? 2 : preset.optionalFirstFrame ? 0 : n;
  const optionalMedia = {};
  let framePair = false;
  if (condition === "MiniMaxH3ReferenceToVideo") {
    const images = h3InputRange(optional, "ref_images", "ref_image_");
    if (images) {
      maxRefs = images.max;
      minRefs = images.min ?? n;
    }
    const videos = h3InputRange(optional, "ref_videos", "ref_video_");
    const audio = h3InputRange(optional, "ref_audios", "ref_audio_");
    if (videos && definitions.LoadVideo?.output?.includes("VIDEO") &&
        definitions.GetVideoComponents?.output?.[0] === "IMAGE") optionalMedia.video = videos.max;
    if (audio && definitions.LoadAudio?.output?.[0] === "AUDIO") optionalMedia.audio = audio.max;
  } else if (condition === "MiniMaxH3ImageToVideo" && optional?.last_frame?.[0] === "IMAGE") {
    framePair = true;
    maxRefs = 2;
  }
  const ancestors = new Set();
  function visit(id) {
    if (ancestors.has(id)) return;
    ancestors.add(id);
    for (const link of Object.values(preset.graph[id]?.inputs || {}))
      if (Array.isArray(link)) visit(String(link[0]));
  }
  if (preset.bindings.styleSource)
    visit(JSON.parse(preset.bindings.styleSource)[0]);
  const styleBaseFields = editable.filter(
    (f) => ancestors.has(f.id) && f.type === "choice",
  );
  let loras = [];
  if (preset.family) {
    const main = styleBaseFields.find((f) => f.input === "unet_name");
    if (main && (preset.family !== "h3" || /minimax[-_]h3/i.test(main.value))) {
      loras = videoStyleFiles(info.loras, preset.family);
    }
  } else if (preset.bindings.styleSource) {
    loras = (preset.bindings.styleFiles || []).filter((f) => info.loras.includes(f));
  }
  return {
    kind: preset.bindings.kind || "image",
    hasPrompt: !!preset.bindings.prompt,
    verbatim: !!preset.bindings.verbatim,
    mediaSlots: {
      image: maxRefs,
      video: preset.bindings.videos?.length || 0,
      audio: preset.bindings.audios?.length || 0,
      ...optionalMedia,
    },
    optionalMedia,
    mentionPatterns: condition === "MiniMaxH3ReferenceToVideo"
      ? { video: "<Video {n}>", audio: "<Audio {n}>" } : preset.bindings.mentionPatterns || {},
    promptLabel: preset.bindings.promptLabel || "提示词",
    outputSize: preset.bindings.outputSize,
    controls: preset.bindings.controls,
    family: preset.family,
    ...(h3FlexAdapters.length === 2 && { fixedSamplingSteps: 6 }),
    ...(poseSwapProfile && { poseSwapProfile }),
    ...(panorama && {panoramaLora:info.loras.find(path => path.split(/[/\\]/).at(-1) === panoramaLoraFile) || null}),
    baseModel: preset.baseModel,
    durationKey: preset.durationKey,
    dependencies,
    styleBaseFields,
    mentionPattern: preset.bindings.mentionPattern,
    id: preset.id,
    name: preset.name,
    workflow: true,
    reference: n > 0,
    needsImage: minRefs > 0,
    maxRefs,
    framePair,
    minRefs,
    fields: editable,
    loras,
  };
}
export function bindPreset(
  preset,
  descriptor,
  values = {},
  styles = [],
  maxSide = Infinity,
  imageCount = preset.bindings.images?.length || 0,
  media = {},
) {
  const graph = structuredClone(preset.graph);
  const assign = (key, value) => {
    const [id, input] = JSON.parse(key);
    graph[id].inputs[input] = value;
  };
  const fields = new Map(descriptor.fields.map((f) => [f.key, f]));
  for (const key of Object.keys(values))
    if (!fields.has(key) && !isCharacterCard(preset.id) && preset.id !== h3VideoModelId) throw fail("工作流输入已变化，请重新配置");
  for (const f of fields.values()) {
    const value = values[f.key] ?? f.value;
    const restoreSize = isImageRestoreModel(preset.id) && f.key === restoreSizeKey;
    if (
      typeof value === "number" &&
      (/(^|[._])(width|height)$/i.test(f.input) || restoreSize) &&
      value > maxSide
    )
      throw fail(f.title + " 超过环境最长边 " + maxSide + " 像素");
    if (restoreSize && value < 1)
      throw fail("输出长边至少为 1 像素");
    if (
      f.type === "choice"
        ? !f.choices.includes(value)
        : f.type === "BOOLEAN"
          ? typeof value !== "boolean"
          : f.type === "STRING"
            ? typeof value !== "string" || value.length > 40000
            : !Number.isFinite(value) ||
              (f.type === "INT" && !Number.isInteger(value)) ||
              value < f.min ||
              value > f.max
    )
      throw fail("请检查当前环境中的工作流参数：" + f.title);
    assign(f.key, value);
  }
  // The typography node always wraps a title in book marks, even when left blank.
  if (preset.id === characterCardId && !graph[1].inputs.value.trim()) {
    graph.blankTitle = { class_type: "EmptyImage", inputs: { width: 340, height: 170, batch_size: 1, color: 16777215 } };
    graph.hideTitle = { class_type: "ImageCompositeMasked", inputs: {
      destination: ["120", 0], source: ["blankTitle", 0], x: 0, y: 0, resize_source: false,
    } };
    graph.frame.inputs.image = ["hideTitle", 0];
  }
  if (preset.id === relayRestoreModelId)
    graph.prepare.inputs.largest_size = Math.ceil(graph.size.inputs.largest_size / 2);
  // At zero strength the plain resize can go straight to the output.
  if (isImageRestoreModel(preset.id) && graph.blend?.inputs.blend_factor === 0)
    graph.out.inputs.images = ["size", 0];
  if (preset.id === secondPassRestoreId && graph.sample.inputs.denoise === 0)
    graph.out.inputs.images = ["size", 0];
  if (preset.id === h3ContinuationModelId) {
    const { resolution, aspect_ratio } = graph.settings.inputs;
    const error = h3ContinuationSizeError(resolution, aspect_ratio, maxSide);
    if (error) throw fail(error);
  }
  if (preset.family === "h3" || !preset.bindings.fixedSeeds)
    for (const node of Object.values(graph))
      for (const key of ["seed", "noise_seed"])
        if (typeof node.inputs[key] === "number") node.inputs[key] = "{{seed}}";
  if (styles.length) {
    const source = JSON.parse(preset.bindings.styleSource);
    const consumers = [];
    for (const n of Object.values(graph))
      for (const [key, value] of Object.entries(n.inputs))
        if (
          Array.isArray(value) &&
          String(value[0]) === source[0] &&
          value[1] === source[1]
        )
          consumers.push([n, key]);
    if (!consumers.length) throw fail("所选模型输出没有连接下游节点");
    let previous = source;
    for (const style of styles) {
      const id = "studio-" + makeId();
      graph[id] = {
        class_type: "LoraLoaderModelOnly",
        inputs: {
          model: previous,
          lora_name: style.name,
          strength_model: style.strength,
        },
      };
      previous = [id, 0];
    }
    for (const [n, key] of consumers) n.inputs[key] = previous;
  }
  if (preset.bindings.prompt) assign(preset.bindings.prompt, "{{prompt}}");
  for (const kind of ["image", "video", "audio"])
    (preset.bindings[kind + "s"] || []).forEach((key, i) =>
      assign(key, "{{" + kind + (i + 1) + "}}"),
    );
  if (preset.family === "h3") {
    if (!Number.isInteger(imageCount) || imageCount < (descriptor.minRefs ?? 1) || imageCount > (descriptor.maxRefs ?? 1))
      throw fail("参考图数量超出当前 H3 工作流支持的范围");
    const conditioning = graph["136"].inputs;
    if (graph["136"].class_type === "MiniMaxH3ReferenceToVideo") {
      const accelerator = graph["146"]?.inputs.value ? "147" : "140";
      const adapter = graph[accelerator]?.inputs.lora_name;
      if (/(?:^|[/\\])dmad_minimax_h3_/i.test(adapter))
        throw fail("DMAD 加速权重适用于文生视频。参考生视频请使用 Ref2VA 专用加速权重。");
      if (h3FlexRefAdapter.test(adapter)) {
        // Match the Pika H3 Flex Ref2VA template's sampler and complete sigma schedule.
        graph["123"].inputs.sampler_name = "lcm";
        graph["124"] = {
          class_type: "ManualSigmas",
          inputs: { sigmas: "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0" },
        };
        graph["126"].inputs.model = [accelerator, 0];
      }
    }
    if (!imageCount) {
      delete conditioning["ref_images.ref_image_0"];
      delete graph["137"];
    }
    for (let i = 1; i < imageCount; i++) {
      const id = "studio-ref-" + (i + 1);
      graph[id] = { class_type: "LoadImage", inputs: { image: "{{image" + (i + 1) + "}}" } };
      const slot = descriptor.framePair ? "last_frame" : "ref_images.ref_image_" + i;
      conditioning[slot] = [id, 0];
    }
    for (const kind of ["video", "audio"]) {
      const count = media?.[kind]?.length || 0;
      if (count > (descriptor.optionalMedia?.[kind] || 0))
        throw fail((kind === "video" ? "参考视频" : "参考音频") + "数量超过当前模型上限");
      for (let i = 0; i < count; i++) {
        const id = "studio-" + kind + "-" + (i + 1);
        const file = "{{" + kind + (i + 1) + "}}";
        if (kind === "video") {
          graph[id] = { class_type: "LoadVideo", inputs: { file } };
          graph[id + "-frames"] = { class_type: "GetVideoComponents", inputs: { video: [id, 0] } };
          conditioning["ref_videos.ref_video_" + i] = [id + "-frames", 0];
        } else {
          graph[id] = { class_type: "LoadAudio", inputs: { audio: file } };
          conditioning["ref_audios.ref_audio_" + i] = [id, 0];
        }
      }
    }
  }
  if (preset.id === panoramaModelId && descriptor.panoramaLora) {
    graph.panoramaLora = {class_type:"LoraLoaderModelOnly",inputs:{model:graph[8].inputs.model,
      lora_name:descriptor.panoramaLora,strength_model:0.8}};
    graph[8].inputs.model = ["panoramaLora",0];
  }
  if (preset.optionalFirstFrame && imageCount === 0) {
    delete graph.image;
    delete graph.latent.inputs.start_image;
  }
  return {
    graph,
    output: preset.bindings.output,
    needsImage: descriptor.needsImage,
    ...(preset.id === panoramaModelId && {preparePanoramaRef:true}),
    prepareVideoRefs: !!descriptor.optionalMedia?.video && !!media?.video?.length,
  };
}
