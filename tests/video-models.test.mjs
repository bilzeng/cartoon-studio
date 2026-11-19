import assert from "node:assert/strict";
import test from "node:test";
import { videoModelPresets, videoStyleFiles } from "../server/video-models.mjs";
import { bindPreset, describePreset } from "../server/workflow-presets.mjs";
import { resolveWorkflowInputs, workflowNeeds } from "../shared/canvas.js";
import { h3Continuation } from "../server/presets/h3-continuation.mjs";
import { h3ContinuationFields } from "../shared/h3-video.js";
import { bundledPresets } from "../server/presets/catalog.mjs";
import {
  relayOriginalRestoreModelId, restoreSizeKey, secondPassRestoreId, redrawStrengthKey,
} from "../shared/image-restore.js";

test("视频权重按模型接入对应的条件节点，风格不会重复叠加加速器", () => {
  const cinematic = "MiniMax-H3/Cinematic.safetensors";
  const inventory = {
    diffusion_models: [
      "video/minimax_h3_singularity_ref2va.safetensors",
      "video/minimax_h3_fl2va.safetensors",
      "video/minimax_h3_hybrid_fl2va_ref2va.safetensors",
      "wan2.2_ti2v_5B_fp16.safetensors",
      "krea2_turbo_bf16.safetensors",
    ],
    text_encoders: [],
    vae: [],
    loras: [
      cinematic,
      "MiniMax-H3/pika_h3_flex_turbo_4step_ref2va.safetensors",
      "Wan2.2/TI2V_5B/ink.safetensors",
      "Krea2/ink.safetensors",
    ],
  };
  const models = videoModelPresets(inventory);
  assert.deepEqual(
    models.map((m) => m.baseModel),
    inventory.diffusion_models.slice(0, 4),
  );
  assert.deepEqual(videoStyleFiles(inventory.loras, "h3"), [cinematic]);
  assert.deepEqual(videoStyleFiles(inventory.loras, "wan22"), [
    inventory.loras[2],
  ]);
  for (const [i, model] of models.slice(0, 3).entries()) {
    const { graph } = bindPreset(model, { fields: [], needsImage: true }, {}, [
      { name: cinematic, strength: 0.75 },
    ]);
    assert.equal(graph[127].inputs.unet_name, model.baseModel);
    assert.equal(
      graph[136].class_type,
      i === 1 ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo",
    );
    assert.deepEqual(
      graph[136].inputs[i === 1 ? "first_frame" : "ref_images.ref_image_0"],
      ["137", 0],
    );
    const [adapter] = graph[140].inputs.model;
    assert.deepEqual(graph[147].inputs.model, [adapter, 0]);
    assert.deepEqual(graph[adapter].inputs, {
      model: ["127", 0],
      lora_name: cinematic,
      strength_model: 0.75,
    });
  }
  const wan = models[3];
  for (const count of [0, 1]) {
    const { graph } = bindPreset(
      wan,
      { fields: [], needsImage: false },
      {},
      [],
      4096,
      count,
    );
    assert.equal(graph.model.inputs.unet_name, wan.baseModel);
    assert.equal(graph.image?.inputs.image, count ? "{{image1}}" : undefined);
    assert.deepEqual(
      graph.latent.inputs.start_image,
      count ? ["image", 0] : undefined,
    );
  }
});

test("H3 只为选用的图片建立输入，首尾帧、容量和提示词编号随模型而变", () => {
  const assets = Array.from({ length: 11 }, (_, i) => ({ id: "asset-" + i, kind: "image" }));
  const guides = assets.map((asset, i) => ({ id: "guide-" + i, data: { assetId: asset.id } }));
  const inputs = { guides, directGuideIds: [guides[0].id], upstream: guides, words: [], series: {} };
  const node = { data: { text: "@图11 是场景", imageRefOrder: guides.map((g) => g.id),
    canvasRefIds: [guides[2].id, guides[10].id] } };
  const loader = { class_type: "LoadImage", inputs: { image: "start.png" } };
  const preset = { family: "h3", bindings: { kind: "video", output: "out", prompt: "",
    images: ['["137","image"]'], mentionPattern: "<Picture {n}>" },
    graph: { 136: { class_type: "MiniMaxH3ReferenceToVideo", inputs: { "ref_images.ref_image_0": ["137", 0] } }, 137: loader,
      out: { class_type: "SaveVideo", inputs: {} } } };
  const defs = { LoadImage: { input: { required: { image: ["COMBO", {}] } } }, SaveVideo: { output_node: true },
    MiniMaxH3ReferenceToVideo: { input: { optional: { ref_images: ["COMFY_AUTOGROW_V3", { template: { prefix: "ref_image_", max: 9 } }] } } },
    MiniMaxH3ImageToVideo: { input: { optional: { last_frame: ["IMAGE", {}] } } } };
  const model = describePreset(preset, defs);
  assert.equal(workflowNeeds(model), "1–9 张图");
  const result = resolveWorkflowInputs(inputs, node, assets, model);
  assert.equal(result.error, "");
  assert.equal(result.prompt, "<Picture 1> 是场景");
  assert.deepEqual(result.media.image, [assets[10], assets[2]]);
  for (const count of [1, 2, 9]) {
    const { graph } = bindPreset(preset, model, {}, [], 4096, count);
    assert.equal(Object.values(graph).filter((v) => v.class_type === "LoadImage").length, count);
    for (let i = 0; i < count; i++) {
      const [id] = graph[136].inputs["ref_images.ref_image_" + i];
      assert.equal(graph[id].inputs.image, "{{image" + (i + 1) + "}}");
    }
  }
  assert.throws(() => bindPreset(preset, model, {}, [], 4096, 10), /参考图数量/);
  node.data = { text: "" };
  assert.deepEqual(resolveWorkflowInputs(inputs, node, assets, model).media.image, [assets[0]]);
  node.data.canvasRefIds = guides.map((r) => r.id);
  assert.match(resolveWorkflowInputs(inputs, node, assets, model).error, /最多接收 9/);
  node.data.canvasRefIds = ["removed"];
  assert.match(resolveWorkflowInputs(inputs, node, assets, model).error, /断开/);
  preset.graph[136] = { class_type: "MiniMaxH3ImageToVideo", inputs: { first_frame: ["137", 0] } };
  const frames = describePreset(preset, defs);
  assert.equal(frames.maxRefs, 2);
  const { graph } = bindPreset(preset, frames, {}, [], 4096, 2);
  assert.equal(graph[graph[136].inputs.last_frame[0]].inputs.image, "{{image2}}");
  assert.equal(bindPreset(preset, frames).graph[136].inputs.last_frame, undefined);
});

test("混合参考按类型独立计数，允许省略任何一类并映射实际选择的编号", () => {
  const assets = ["video", "video", "audio", "audio"].map((kind, i) => ({ id: "a" + i, kind }));
  const upstream = assets.map((a, i) => ({ id: "n" + i, data: { assetId: a.id } }));
  const inputs = { guides: [], upstream, words: [], series: {} };
  const model = {kind: "video", maxRefs: 9, minRefs: 0, fields: [], mediaSlots: {image: 9, video: 3, audio: 3},
    optionalMedia: { video: 3, audio: 3 }, mentionPatterns: {video: "<Video {n}>", audio: "<Audio {n}>"} };
  const node = {data: {text: "@视频2 配合 @语音2", selectedMediaRefs: {video: ["n0"], audio: []}}};
  const r = resolveWorkflowInputs(inputs, node, assets, model);
  assert.equal(r.error, "");
  assert.equal(r.prompt, "<Video 1> 配合 <Audio 1>");
  assert.deepEqual(r.media, {image: [], video: [assets[1], assets[0]], audio: [assets[3]]});
  const preset = {family:"h3", graph:{136:{class_type:"MiniMaxH3ReferenceToVideo",inputs:{"ref_images.ref_image_0":["137",0]}},137:{class_type:"LoadImage",inputs:{image:"ref.png"}}},
    bindings:{images:['["137","image"]']}};
  const {graph} = bindPreset(preset, model, {}, [], 4096, 0, r.media);
  assert.equal(graph[137], undefined);
  assert.equal(graph[136].inputs["ref_images.ref_image_0"], undefined);
  assert.deepEqual(graph[136].inputs["ref_videos.ref_video_1"], ["studio-video-2-frames",0]);
  assert.equal(graph["studio-video-2"].inputs.file, "{{video2}}");
  assert.equal(graph["studio-audio-1"].inputs.audio, "{{audio1}}");
  assert.throws(() => bindPreset(preset, model, {}, [], 4096, 1, {video: Array(4)}), /上限/);
});

test("两段续接共用已选参考图，校验第二段提示词并独立传递时长", () => {
  const assets = [{ id: "a", kind: "image" }, { id: "b", kind: "image" }];
  const guides = assets.map((asset) => ({ id: asset.id, data: { assetId: asset.id } }));
  const inputs = { guides, directGuideIds: ["a", "b"], upstream: guides, words: [], series: {} };
  const values = {
    [h3ContinuationFields.firstDuration]: 2,
    [h3ContinuationFields.secondDuration]: 4,
  };
  const node = { data: { text: "固定机位，@图2 低头", canvasRef: "b", workflowValues: values } };
  const model = {
    id: h3Continuation.id, kind: "video", maxRefs: 1, minRefs: 1, needsImage: true,
    mentionPattern: "<Picture {n}>",
    fields: [
      { key: h3ContinuationFields.firstDuration, type: "FLOAT", min: 0.2, max: 30 },
      { key: h3ContinuationFields.secondDuration, type: "FLOAT", min: 0.2, max: 30 },
      { key: h3ContinuationFields.secondPrompt, type: "STRING" },
    ],
  };
  assert.match(resolveWorkflowInputs(inputs, node, assets, model).error, /填写第二段/);
  values[h3ContinuationFields.secondPrompt] = "@图1 抬头";
  assert.match(resolveWorkflowInputs(inputs, node, assets, model).error, /共用的参考图/);
  values[h3ContinuationFields.secondPrompt] = "@图2 抬头";
  const resolved = resolveWorkflowInputs(inputs, node, assets, model);
  assert.equal(resolved.error, "");
  assert.equal(resolved.prompt, "固定机位，<Picture 1> 低头");
  assert.equal(resolved.secondPrompt, "<Picture 1> 抬头");
  assert.deepEqual(resolved.media.image, [assets[1]]);
  const bound = { ...values, [h3ContinuationFields.secondPrompt]: resolved.secondPrompt };
  const { graph, output } = bindPreset(h3Continuation, model, bound);
  assert.equal(graph.reference.inputs.image, "{{image1}}");
  assert.equal(graph.first.inputs.prompt, "{{prompt}}");
  assert.equal(graph.second.inputs.prompt, resolved.secondPrompt);
  assert.equal(graph.first.inputs.seconds, 2);
  assert.equal(graph.second.inputs.seconds, 4);
  assert.deepEqual(graph.first.inputs.media, graph.second.inputs.media);
  assert.deepEqual(graph.second.inputs.previous_segment, ["first", 0]);
  assert.deepEqual(graph[output].inputs.final_segment, ["second", 0]);
  assert.throws(() => bindPreset(h3Continuation, model, bound, [], 500), /最长边上限/);
});

test("二采放大在目标尺寸编码原图，零重绘跳过采样", () => {
  const preset = bundledPresets.find(p => p.id === secondPassRestoreId);
  const descriptor = { fields: [
    { key: restoreSizeKey, input: "largest_size", title: "输出长边", type: "INT", min: 1, max: 16384, value: 2560 },
    { key: redrawStrengthKey, input: "denoise", title: "重绘强度", type: "FLOAT", min: 0, max: 0.5, value: 0.12 },
  ] };
  const bind = values => bindPreset(preset, descriptor, values, [], 4096).graph;
  const graph = bind({ [restoreSizeKey]: 2051, [redrawStrengthKey]: 0.16 });
  assert.equal(graph.size.inputs.largest_size, 2051);
  assert.deepEqual(graph.dimensions.inputs.image, ["size", 0]);
  assert.deepEqual(graph.encode.inputs.pixels, ["aligned", 0]);
  assert.deepEqual(graph.sample.inputs.latent_image, ["encode", 0]);
  assert.equal(graph.sample.inputs.denoise, 0.16);
  assert.deepEqual(graph.decode.inputs.samples, ["sample", 0]);
  assert.deepEqual(graph.result.inputs, {
    image: ["decode", 0], width: ["dimensions", 0], height: ["dimensions", 1],
    upscale_method: "bicubic", crop: "disabled",
  });
  assert.deepEqual(graph.out.inputs.images, ["result", 0]);
  assert.deepEqual(bind({ [redrawStrengthKey]: 0 }).out.inputs.images, ["size", 0]);
  assert.throws(() => bind({ [redrawStrengthKey]: 0.9 }), /工作流参数/);
  assert.throws(() => bind({ [restoreSizeKey]: 8192 }), /最长边/);
});

test("图片原流程沿用镜头 27 的 RelayVSR 参数和原图输入", () => {
  const preset = bundledPresets.find((p) => p.id === relayOriginalRestoreModelId);
  const descriptor = {
    fields: [{ key: restoreSizeKey, input: "largest_size", title: "输出长边",
      type: "INT", min: 0, max: 16384, value: 2560 }],
  };
  const { graph } = bindPreset(preset, descriptor, { [restoreSizeKey]: 2048 }, [], 4096);
  assert.deepEqual(preset.bindings.controls, [restoreSizeKey]);
  assert.equal(graph.source.inputs.image, "{{image1}}");
  assert.deepEqual(graph[205].inputs.images, ["source", 0]);
  assert.deepEqual(graph[211].inputs.images, ["source", 0]);
  assert.equal(graph[206].inputs.noise_seed, 26112027);
  assert.equal(graph[208].inputs.sampler_name, "euler");
  assert.equal(graph[209].inputs.steps, 1);
  assert.equal(graph[211].inputs.detail, 1);
  assert.deepEqual(graph.size.inputs, { image: ["211", 0], upscale_method: "lanczos", largest_size: 2048 });
  assert.deepEqual(graph.out.inputs.images, ["size", 0]);
  assert.ok(!Object.values(graph).some((n) => n.class_type === "ImageBlend"));
  assert.throws(() => bindPreset(preset, descriptor, { [restoreSizeKey]: 8192 }, [], 4096), /超过环境最长边/);
});

test("镜头01一采仅提交 H3，高清修复按选定分辨率重新采样并复用一采音轨", () => {
  const preview = bundledPresets.find(p => p.id === "studio:preset:h3-2k");
  const descriptor = {fields: [], minRefs: 0, maxRefs: 9};
  const graph = bindPreset(preview, descriptor, {}, [], 2048, 3).graph;
  assert.deepEqual(graph[preview.bindings.output].inputs.video, ["130", 0]);
  assert.deepEqual(graph[130].inputs.images, ["122", 0]);
  assert.deepEqual(graph[130].inputs.audio, ["121", 0]);
  assert.equal(graph[130].inputs.fps, 24);
  assert.deepEqual(graph[136].inputs["ref_images.ref_image_2"], ["studio-ref-3", 0]);
  assert.ok(!Object.values(graph).some(n => /RelayVSR|VSRDecode/.test(n.class_type)));
  const hd = bundledPresets.find(p => p.id === "studio:preset:video-upscale-4k");
  assert.deepEqual(hd.bindings.outputSize, [3840, 2160]);
  const bound = bindPreset(hd, {fields: []}).graph;
  assert.deepEqual(bound[205].inputs.images, ["prepare", 0]);
  assert.deepEqual(bound[211].inputs.images, ["prepare", 0]);
  assert.deepEqual(bound[211].inputs.samples, ["210", 0]);
  assert.match(bound.inputWidth.inputs.expression, /1920/);
  assert.match(bound.width.inputs.expression, /3840/);
  assert.deepEqual(bound[213].inputs.audio, ["components", 1]);
  assert.deepEqual(bound[213].inputs.fps, ["components", 2]);
});

test("旧角色卡节点使用已连接的原图，三个视图共用身份且可独立填写署名", () => {
  const preset = bundledPresets.find(p => p.id === "studio:preset:character-2k");
  const source = {id: "portrait", kind: "image"};
  const guide = { id: "n1", data: { assetId: source.id, title: "原图" } };
  const inputs = { guides: [guide], upstream: [guide] };
  const oldNode = {data: {canvasRef: "none", text: "旧选角描述"}};
  const result = resolveWorkflowInputs(inputs, oldNode, [source], {id: preset.id});
  assert.deepEqual(result.media.image, [source]);
  assert.equal(result.prompt, "");
  assert.equal(result.error, "");
  assert.ok(resolveWorkflowInputs({...inputs, guides: []}, oldNode, [], {id: preset.id}).error);
  const fields = ["1", "2"].map(id => ({id, key: JSON.stringify([id, "value"]), type: "STRING", value: ""}));
  const graph = bindPreset(preset, {fields}, {[fields[0].key]: "短剧", [fields[1].key]: "青禾"}).graph;
  assert.equal(graph.source.inputs.image, "{{image1}}");
  assert.deepEqual(graph[50].inputs["images.image_1"], ["source", 0]);
  assert.deepEqual(graph[200].inputs["images.image_1"], ["source", 0]);
  assert.deepEqual(graph[70].inputs["images.image_1"], ["202", 0]);
  assert.deepEqual(graph[120].inputs.project_name, ["1", 0]);
  assert.equal(graph[1].inputs.value, "短剧");
  assert.equal(graph[2].inputs.value, "青禾");
  assert.deepEqual(graph[120].inputs.character_name, ["2", 0]);
  assert.deepEqual(bindPreset(preset, {fields}).graph.frame.inputs.image, ["hideTitle", 0]);
});

test("二采沿用创建修复节点时选用的视频版本", () => {
  const assets = ["approved", "later"].map(id => ({ id, kind: "video" }));
  const upstream = [{id: "clip", data: {assetId: "later"}}];
  const inputs = {upstream, guides: [], words: [], series: {}};
  const node = {data: {text: "", videoRestoreSource: {nodeId: "clip", assetId: "approved"}}};
  const model = {id: "studio:preset:video-upscale-4k", kind: "video", maxRefs: 0, mediaSlots: {video: 1}};
  assert.deepEqual(resolveWorkflowInputs(inputs, node, assets, model).media.video, [assets[0]]);
  assert.ok(resolveWorkflowInputs(inputs, node, assets.slice(1), model).error);
});
