import { h3ContinuationFields, h3ContinuationModelId } from "../../shared/h3-video.js";

const model = "fastvideo_fasth3_8step_v2_pruned_bf16.safetensors";
const loras = {
  lora_1: "pika_h3_flex_ref2va_v1_bf16.safetensors",
  lora_1_strength: 1,
};
for (let slot = 2; slot <= 9; slot++) {
  loras[`lora_${slot}`] = "none";
  loras[`lora_${slot}_strength`] = 1;
}

export const h3Continuation = {
  id: h3ContinuationModelId,
  name: "H3 · 两段续接",
  durationKey: h3ContinuationFields.firstDuration,
  graph: {
    loader: {
      class_type: "AICG3D_H3Loader",
      inputs: {
        fl2va_model: "none",
        ref2va_model: model,
        text_encoder: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
        video_vae: "minimax_h3_video_vae_fp16.safetensors",
        audio_vae: "minimax_h3_audio_vae_fp32.safetensors",
        ...loras,
        non_h3_policy: "按所选加载",
        "注意力加速(Sage)": "自动（Sage 优先）",
      },
    },
    settings: {
      class_type: "AICG3D_H3SequenceGlobal",
      inputs: {
        h3_bundle: ["loader", 0],
        resolution: "360P",
        aspect_ratio: "16:9",
        fps: 24,
        handoff_frames: 22,
        handoff_mode: "尾帧续写（latent）",
        ref_image_size: "match",
        sampler_name: "er_sde",
        scheduler: "beta",
        steps: 6,
        denoise: 1,
        vram_policy: "释放缓存",
        sample_preview: "关",
        preview_interval: 1,
        prompt_optimizer_settings: false,
        audio_mode: "生成音频",
        vram_tier: "自动（按显卡）",
        exposure_lock: "跨段曝光锁定",
        keep_full: false,
        segment_output_directory: "",
        segment_cleanup_policy: "保留分段视频",
      },
    },
    reference: { class_type: "LoadImage", inputs: { image: "reference.png" } },
    media: {
      class_type: "AICG3D_H3MediaBridge",
      inputs: {
        image_count: 1, video_count: 0, audio_count: 0, image_1: ["reference", 0],
      },
    },
    first: {
      class_type: "AICG3D_H3SequenceSegment",
      _meta: { title: "H3 生成第一段" },
      inputs: {
        sequence_config: ["settings", 0],
        media: ["media", 0],
        prompt: "",
        seconds: 3,
        seed: 1,
        guide_frame_idx: 0,
      },
    },
    second: {
      class_type: "AICG3D_H3SequenceSegment",
      _meta: { title: "H3 续接第二段" },
      inputs: {
        previous_segment: ["first", 0],
        media: ["media", 0],
        prompt: "",
        seconds: 3,
        seed: 1,
        guide_frame_idx: 0,
      },
    },
    output: {
      class_type: "AICG3D_H3SequenceCombine",
      _meta: { title: "H3 合成两段成片" },
      inputs: { final_segment: ["second", 0], filename_prefix: "CartoonStudio/H3-continuation" },
    },
  },
  bindings: {
    kind: "video",
    prompt: JSON.stringify(["first", "prompt"]),
    promptLabel: "第一段 · 起始画面与动作",
    mentionPattern: "<Picture {n}>",
    images: [JSON.stringify(["reference", "image"])],
    output: "output",
    controls: Object.values(h3ContinuationFields),
  },
};
