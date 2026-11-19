import { videoUpscale2kId } from "../../shared/generation-size.js";
import { readFileSync } from "node:fs";
import { h3Fields, h3VideoModelId } from "../../shared/h3-video.js";
import { h3Continuation } from "./h3-continuation.mjs";
import { poseSwapPreset } from "./pose-swap.mjs";
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
  prompt: field(4),
  output: "100",
  images: [],
  controls: [1, 2, 3, 216].map((id) => field(id)),
  outputSize: [2560, 1440],
  promptLabel: "角色外貌与服装",
  fixedSeeds: true,
};
const plain = structuredClone(character);
plain[130].inputs.image = plain[120].inputs.images;
// Only render the final sheet in this variant. The original includes separate archive outputs.
const sheet = {};
function collect(id) {
  if (sheet[id]) return;
  sheet[id] = plain[id];
  for (const value of Object.values(plain[id].inputs))
    if (Array.isArray(value)) collect(value[0]);
}
collect("100");
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
const upscale = {
  ...relayUpscale(["components", 0]),
  213: structuredClone(h3[213]),
  214: structuredClone(h3[214]),
};
upscale[213].inputs.fps = ["components", 2];
upscale[213].inputs.audio = ["components", 1];
upscale[214].inputs.filename_prefix = "CartoonStudio/RelayVSR/2K";
const outputDimension = (expression) => ({
  class_type: "ComfyMathExpression",
  inputs: { expression, "values.a": ["size", 0], "values.b": ["size", 1] },
});
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
    id: "studio:preset:character-2k",
    name: "角色卡 · 特写 / 正面 / 背面 2K",
    graph: character,
    bindings: characterBindings,
  },
  {
    id: "studio:preset:character-plain-2k",
    name: "角色卡 · 无字三栏 2K",
    graph: sheet,
    bindings: { ...characterBindings, controls: [216].map((id) => field(id)) },
  },
  {
    id: h3VideoModelId,
    family: "h3",
    durationKey: h3Fields.duration,
    name: "H3 · 参考图生成视频 2K",
    graph: h3,
    bindings: {
      kind: "video",
      output: "214",
      prompt: field(138),
      images: [field(137, "image")],
      controls: Object.values(h3Fields),
      styleSource: JSON.stringify(["127", 0]),
      mentionPattern: "<Picture {n}>",
      promptLabel: "动作、运镜与声音",
      fixedSeeds: true,
      outputSize: [2560, 1440],
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
  {
    id: videoUpscale2kId,
    name: "成片放大到 2K · RelayVSR",
    graph: {
      ...clipInput,
      ...upscale,
      size: { class_type: "GetImageSize", inputs: { image: ["components", 0] } },
      width: outputDimension("2560 if a >= b else 1440"),
      height: outputDimension("1440 if a >= b else 2560"),
      212: {
        class_type: "ResizeAndPadImage",
        inputs: {
          image: ["211", 0], target_width: ["width", 1], target_height: ["height", 1],
          interpolation: "lanczos", padding_color: "black",
        },
        _meta: { title: "等比适配 2K 画幅" },
      },
    },
    bindings: {
      kind: "video", output: "214", prompt: "", images: [], videos: [field("source", "file")],
      controls: [], outputSize: [2560, 1440],
    },
  },
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
