import { characterCardId, plainCharacterCardId, characterNameKey, characterTitleKey } from "../../shared/character-card.js";
import { videoUpscale2kId, videoUpscale4kId } from "../../shared/generation-size.js";
import { readFileSync } from "node:fs";
import { h3Fields, h3VideoModelId } from "../../shared/h3-video.js";
import { h3Continuation } from "./h3-continuation.mjs";
import { poseSwapPreset } from "./pose-swap.mjs";
import { secondPassRestore } from "./second-pass-restore.mjs";
import {
  restoreModelId,
  relayRestoreModelId,
  relayOriginalRestoreModelId,
  restoreSizeKey,
  defaultRestoreSize,
  defaultRestoreStrength,
  relayRestoreSize,
  restoreStrengthKey,
} from "../../shared/image-restore.js";
const load = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const character = load("character.json");
const h3 = load("h3.json");
const field = (id, name = "value") => JSON.stringify([String(id), name]);
const characterBindings = {
  kind: "image",
  prompt: "",
  output: "100",
  images: [field("source", "image")],
  controls: [characterNameKey, characterTitleKey],
  outputSize: [2560, 1440],
  fixedSeeds: true,
};
const plain = structuredClone(character);
plain.frame.inputs.image = ["91", 0];
for (const id of ["1", "2", "3", "120"]) delete plain[id];

// Shot 01 saves the H3 preview at node 92, before the independent RelayVSR pass.
const preview = Object.fromEntries(Object.entries(h3).filter(([id]) => Number(id) < 200 && !["163", "164"].includes(id)));
preview[92] = {
  ...structuredClone(h3[214]),
  inputs: { ...h3[214].inputs, video: ["130", 0], filename_prefix: "CartoonStudio/H3/Preview" },
  _meta: { title: "保存一采预览" },
};
const clipInput = {
  source: { class_type: "LoadVideo", inputs: { file: "video.mp4" } },
  components: {
    class_type: "GetVideoComponents",
    inputs: { video: ["source", 0] },
  },
};
function relayUpscale(images) {
  const graph = Object.fromEntries(
    ["203", "204", "205", "206", "207", "208", "209", "210", "211"]
      .map(id => [id, structuredClone(h3[id])]),
  );
  graph[205].inputs.images = graph[211].inputs.images = images;
  return graph;
}
const outputDimension = (expression) => ({
  class_type: "ComfyMathExpression",
  inputs: { expression, "values.a": ["size", 0], "values.b": ["size", 1] },
});
function videoUpscalePreset(id, long, short, label) {
  const is4k = id === videoUpscale4kId;
  // Shot 01 uses a centered Lanczos crop to deliver a standard 16:9 master.
  const fit = (image, width, height) => ({
    class_type: "ImageScale",
    inputs: { image, width: [width, 1], height: [height, 1], upscale_method: "lanczos", crop: "center" },
  });
  const dimensions = (w, h) => outputDimension(w + " if a >= b else " + h);
  const graph = {
    ...clipInput,
    size: { class_type: "GetImageSize", inputs: { image: ["components", 0] } },
    width: dimensions(long, short),
    height: dimensions(short, long),
    ...(is4k && {
      inputWidth: dimensions(long / 2, short / 2),
      inputHeight: dimensions(short / 2, long / 2),
      prepare: fit(["components", 0], "inputWidth", "inputHeight"),
    }),
    ...relayUpscale(is4k ? ["prepare", 0] : ["components", 0]),
    212: fit(["211", 0], "width", "height"),
    213: structuredClone(h3[213]),
    214: structuredClone(h3[214]),
  };
  graph[206].inputs.noise_seed = 26112001;
  graph[213]._meta.title = "接回源片声音";
  graph[214]._meta.title = "保存 " + label + " 成片";
  graph[213].inputs.fps = ["components", 2];
  graph[213].inputs.audio = ["components", 1];
  graph[214].inputs.filename_prefix = "CartoonStudio/RelayVSR/" + label;
  return {
    id, name: "视频高清修复 · RelayVSR 二采 " + label, graph,
    bindings: {
      kind: "video", output: "214", prompt: "", images: [], videos: [field("source", "file")],
      controls: [], outputSize: [long, short], fixedSeeds: true,
    },
  };
}
function imageRestorePreset(id, algorithm, upscaleNodes, enhancedSource, size, strength) {
  return {
    id,
    name: "高清修复 · " + algorithm,
    graph: {
      source: { class_type: "LoadImage", inputs: { image: "source.png" } },
      ...upscaleNodes,
      size: {
        class_type: "ImageScaleToMaxDimension",
        _meta: { title: "输出长边（像素）" },
        inputs: {
          image: ["source", 0],
          upscale_method: "bicubic",
          largest_size: size,
        },
      },
      dimensions: { class_type: "GetImageSize", inputs: { image: ["size", 0] } },
      enhanced: {
        class_type: "ImageScale",
        inputs: {
          image: enhancedSource,
          upscale_method: "lanczos",
          width: ["dimensions", 0],
          height: ["dimensions", 1],
          crop: "disabled",
        },
      },
      blend: {
        class_type: "ImageBlend",
        _meta: { title: "细节增强" },
        inputs: {
          image1: ["size", 0],
          image2: ["enhanced", 0],
          blend_mode: "normal",
          blend_factor: strength,
        },
      },
      out: {
        class_type: "SaveImage",
        inputs: {
          images: ["blend", 0],
          filename_prefix: "CartoonStudio/restored",
        },
      },
    },
    bindings: {
      kind: "image",
      output: "out",
      prompt: "",
      images: [field("source", "image")],
      controls: [restoreSizeKey, restoreStrengthKey],
      ...(id === relayRestoreModelId && { fixedSeeds: true }),
    },
  };
}

export const bundledPresets = [
  secondPassRestore,
  imageRestorePreset(restoreModelId, "RealESRGAN", {
    model: { class_type: "UpscaleModelLoader", inputs: { model_name: "RealESRGAN_x4plus.pth" } },
    restore: {
      class_type: "ImageUpscaleWithModel",
      inputs: { image: ["source", 0], upscale_model: ["model", 0] },
    },
  }, ["restore", 0], defaultRestoreSize, defaultRestoreStrength),
  imageRestorePreset(relayRestoreModelId, "RelayVSR（可调强度）", {
    prepare: {
      class_type: "ImageScaleToMaxDimension",
      inputs: { image: ["source", 0], upscale_method: "bicubic", largest_size: relayRestoreSize / 2 },
    },
    ...relayUpscale(["prepare", 0]),
  }, ["211", 0], relayRestoreSize, 1),
  {
    id: relayOriginalRestoreModelId,
    name: "高清修复 · RelayVSR 原流程",
    graph: {
      source: { class_type: "LoadImage", inputs: { image: "source.png" } },
      ...relayUpscale(["source", 0]),
      size: {
        class_type: "ImageScaleToMaxDimension",
        _meta: { title: "Lanczos · 按原比例输出" },
        inputs: { image: ["211", 0], upscale_method: "lanczos", largest_size: relayRestoreSize },
      },
      out: {
        class_type: "SaveImage",
        inputs: { images: ["size", 0], filename_prefix: "CartoonStudio/RelayVSR/Original" },
      },
    },
    bindings: {
      kind: "image", output: "out", prompt: "", fixedSeeds: true,
      images: [field("source", "image")], controls: [restoreSizeKey],
    },
  },
  {
    id: characterCardId,
    name: "参考图角色卡 · 特写 / 正面 / 背面 2K",
    graph: character,
    bindings: characterBindings,
  },
  {
    id: plainCharacterCardId,
    name: "角色卡 · 无字三栏 2K",
    graph: plain,
    bindings: { ...characterBindings, controls: [] },
  },
  {
    id: h3VideoModelId,
    family: "h3",
    durationKey: h3Fields.duration,
    name: "H3 · 多参考图一采预览",
    graph: preview,
    bindings: {
      kind: "video",
      output: "92",
      prompt: field(138),
      images: [field(137, "image")],
      controls: Object.values(h3Fields),
      styleSource: JSON.stringify(["127", 0]),
      mentionPattern: "<Picture {n}>",
      promptLabel: "动作、运镜与声音",
      fixedSeeds: true,
      outputSize: [1344, 768],
    },
  },
  {
    id: "studio:preset:spark-narration",
    name: "文字转旁白 · Spark-TTS",
    graph: {
      speech: {
        class_type: "SparkTTSRun",
        inputs: {
          text: "",
          gender: "female",
          age: "Youth-Adult",
          pitch: "moderate",
          speed: "moderate",
          temperature: 0.8,
          top_k: 50,
          top_p: 0.95,
          max_new_tokens: 3000,
          do_sample: true,
          unload_model: true,
          seed: 0,
        },
      },
      out: {
        class_type: "SaveAudioMP3",
        inputs: {
          audio: ["speech", 0],
          filename_prefix: "CartoonStudio/narration",
          quality: "V0",
        },
      },
    },
    bindings: {
      kind: "audio",
      prompt: field("speech", "text"),
      promptLabel: "旁白台词",
      verbatim: true,
      output: "out",
      images: [],
      controls: ["gender", "age", "pitch", "speed"].map((k) =>
        field("speech", k),
      ),
    },
  },
  {
    id: "studio:preset:extract-sound",
    name: "视频提取音轨 · MP3",
    graph: {
      ...clipInput,
      out: {
        class_type: "SaveAudioMP3",
        inputs: {
          audio: ["components", 1],
          filename_prefix: "CartoonStudio/audio",
          quality: "V0",
        },
      },
    },
    bindings: {
      kind: "audio",
      prompt: "",
      output: "out",
      images: [],
      videos: [field("source", "file")],
      controls: [],
    },
  },
  videoUpscalePreset(videoUpscale2kId, 2560, 1440, "2K"),
  videoUpscalePreset(videoUpscale4kId, 3840, 2160, "4K"),
  {
    id: "studio:preset:replace-sound",
    name: "视频配音 · 替换音轨",
    graph: {
      ...clipInput,
      sound: { class_type: "LoadAudio", inputs: { audio: "voice.wav" } },
      compose: {
        class_type: "CreateVideo",
        inputs: {
          images: ["components", 0],
          fps: ["components", 2],
          audio: ["sound", 0],
        },
      },
      out: {
        class_type: "SaveVideo",
        inputs: {
          video: ["compose", 0],
          filename_prefix: "CartoonStudio/video",
          format: "mp4",
          "format.codec": "h264",
          "format.codec.encoding": "auto",
        },
      },
    },
    bindings: {
      kind: "video",
      prompt: "",
      output: "out",
      images: [],
      videos: [field("source", "file")],
      audios: [field("sound", "audio")],
      controls: [],
    },
  },
  h3Continuation,
  poseSwapPreset,
];
