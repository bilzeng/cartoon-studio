import assert from "node:assert/strict";
import test from "node:test";
import { bundledPresets } from "../server/presets/catalog.mjs";
import { bindPreset } from "../server/workflow-presets.mjs";
import { h3Fields, h3VideoModelId } from "../shared/h3-video.js";

test("H3 Ref2VA 使用 Pika Flex 配套采样，并为每次生成注入随机种子", () => {
  const preset = structuredClone(bundledPresets.find(p => p.id === h3VideoModelId));
  const adapter = "minimax/pika_h3_flex_ref2va_v1_bf16.safetensors";
  for (const id of ["140", "147"]) preset.graph[id].inputs.lora_name = adapter;
  const descriptor = {
    fields: [{ key: h3Fields.fast, id: "146", input: "value", type: "BOOLEAN", value: false }],
    minRefs: 0,
    maxRefs: 9,
  };
  for (const fast of [false, true]) {
    const { graph } = bindPreset(preset, descriptor, { [h3Fields.fast]: fast }, [], 4096, 2);
    assert.equal(graph["123"].inputs.sampler_name, "lcm");
    assert.equal(graph["124"].class_type, "ManualSigmas");
    assert.deepEqual(graph["124"].inputs.sigmas.split(",").map(Number),
      [1, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0]);
    assert.deepEqual(graph["126"].inputs.model, [fast ? "147" : "140", 0]);
    assert.equal(graph["129"].inputs.noise_seed, "{{seed}}");
  }
  preset.graph["140"].inputs.lora_name = "minimax/dmad_minimax_h3_8step_full_critic_comfyui.safetensors";
  assert.throws(() => bindPreset(preset, descriptor, {}, [], 4096, 2), /Ref2VA/);
});
