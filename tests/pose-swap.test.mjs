import assert from "node:assert/strict";
import test from "node:test";
import { bindPoseSwap, poseSwapPreset } from "../server/presets/pose-swap.mjs";
import { bindPreset } from "../server/workflow-presets.mjs";
import { assignPoseSwapReference, canvasInputs, resolveWorkflowInputs } from "../shared/canvas.js";
import { poseOutfitGalleryTag } from "../shared/pose-swap.js";
import { makeNode } from "../shared/studio.js";

test("PoseSwap replaces a dedicated outfit in place, including legacy gallery nodes", () => {
  const old = { id: "old-dress", name: "旧服装.webp", kind: "image", importTags: [poseOutfitGalleryTag] };
  const photo = { id: "local-photo", name: "新服装.png", kind: "image" };
  const next = { id: "next-photo", name: "第三件.png", kind: "image" };
  const outfit = makeNode("image", { x: 12, y: 50 }, { assetId: old.id, title: old.name });
  const target = makeNode("image", { x: 500, y: 50 }, {
    imageModel: poseSwapPreset.id, poseSwapRefs: { outfit: outfit.id },
  });
  const board = { nodes: [outfit, target], edges: [{ id: "outfit-edge", source: outfit.id, target: target.id }], order: [] };
  const swapped = assignPoseSwapReference(board, target.id, "outfit", { asset: photo }, [old]);
  const again = assignPoseSwapReference(swapped, target.id, "outfit", { asset: next }, [photo]);
  assert.deepEqual(again.nodes.map(n => n.id), board.nodes.map(n => n.id));
  assert.deepEqual(again.edges, board.edges);
  assert.deepEqual(again.nodes[0].position, outfit.position);
  assert.equal(again.nodes[0].data.assetId, next.id);
  assert.equal(again.nodes[0].data.title, next.name);
  assert.equal(again.nodes[1].data.poseSwapRefs.outfit, outfit.id);
});

test("PoseSwap preserves a shared guide and does not treat an old outfit as the person", () => {
  const old = { id: "old-dress", name: "姿势和旧衣.webp", kind: "image", importTags: [poseOutfitGalleryTag] };
  const next = { id: "new-dress", name: "新服装.webp", kind: "image", importTags: [poseOutfitGalleryTag] };
  const stale = { id: "stale-dress", name: "曾选服装.webp", kind: "image", importTags: [poseOutfitGalleryTag] };
  const guide = makeNode("image", { x: 12, y: 50 }, { assetId: old.id, title: old.name });
  const prior = makeNode("image", { x: 12, y: 310 }, { assetId: stale.id, title: stale.name });
  const target = makeNode("image", { x: 500, y: 50 }, {
    imageModel: poseSwapPreset.id, poseSwapRefs: { pose: guide.id, outfit: guide.id },
  });
  const board = { nodes: [guide, prior, target], edges: [guide, prior].map((n) =>
    ({ id: n.id, source: n.id, target: target.id })), order: [] };
  const assets = [old, stale, next];
  const swapped = assignPoseSwapReference(board, target.id, "outfit", { asset: next }, assets);
  const current = swapped.nodes.find((n) => n.id === target.id);
  assert.equal(swapped.nodes[0].data.assetId, old.id);
  assert.equal(current.data.poseSwapRefs.pose, guide.id);
  const inputs = canvasInputs({ ...swapped, series: {} }, current, assets);
  const resolved = resolveWorkflowInputs(inputs, current, assets, { id: poseSwapPreset.id });
  assert.equal(resolved.roles.outfit.asset.id, next.id);
  assert.match(resolved.error, /请选择人物/);
  const picked = assignPoseSwapReference(swapped, target.id, "outfit", { id: prior.id }, assets);
  assert.deepEqual(picked.nodes.map(n => n.id), board.nodes.map(n => n.id));
  assert.deepEqual(picked.edges, board.edges);
});

test("PoseSwap detaches an old outfit from the edited target when another node uses it", () => {
  const old = { id: "original", name: "共享服装.webp", kind: "image", importTags: [poseOutfitGalleryTag] };
  const next = { id: "replace", name: "新服装.webp", kind: "image" };
  const shared = makeNode("image", { x: 0, y: 0 }, { assetId: old.id, title: old.name });
  const target = makeNode("image", { x: 500, y: 0 }, {
    imageModel: poseSwapPreset.id, poseSwapRefs: { outfit: shared.id },
  });
  const other = makeNode("image", { x: 500, y: 245 });
  const edges = [target, other].map((n) => ({ id: n.id, source: shared.id, target: n.id }));
  const board = { nodes: [shared, target, other], edges, order: [] };
  const result = assignPoseSwapReference(board, target.id, "outfit", { asset: next }, [old, next]);
  assert.deepEqual(result.nodes[0], shared);
  assert.deepEqual(result.edges.filter((e) => e.source === shared.id), [edges[1]]);
  assert.equal(result.edges.filter((e) => e.target === target.id).length, 1);
});

test("PoseSwap distinguishes the person from a photo shared by the pose and outfit roles", () => {
  const model = { id: poseSwapPreset.id };
  const photo = { id: "photo", kind: "image" };
  const person = { id: "person", kind: "image" };
  const guide = (asset) => ({ id: asset.id, data: { assetId: asset.id } });
  const node = { data: { text: "", poseSwapRefs: { pose: "photo", outfit: "photo" } } };
  const inputs = { guides: [guide(photo)] };
  assert.match(resolveWorkflowInputs(inputs, node, [photo], model).error, /人物或模特/);
  inputs.guides.push(guide(person));
  const resolved = resolveWorkflowInputs(inputs, node, [person, photo], model);
  assert.equal(resolved.error, "");
  assert.deepEqual(resolved.media.image, [person, photo, photo]);
  node.data.poseSwapRefs.person = "removed";
  assert.match(resolveWorkflowInputs(inputs, node, [person, photo], model).error, /已断开/);
});

test("PoseSwap keeps role order and conditions combined edits on all three references in one pass", () => {
  const person = {};
  const pose = { asset: { name: "背部后仰・双手撩发.webp" } };
  const outfit = { asset: { name: "brown leather boots.webp", importTags: [poseOutfitGalleryTag] } };
  const bind = (roles, profile) =>
    bindPoseSwap(bindPreset(poseSwapPreset, { fields: [], needsImage: true }), roles, "", profile).graph;
  const singlePose = bind({ person, pose });
  assert.equal(singlePose.outfit, undefined);
  assert.deepEqual(singlePose.out.inputs.images, ["pose-decode", 0]);
  assert.equal(singlePose.pose.inputs.image, "{{image2}}");
  const singleOutfit = bind({ person, outfit });
  assert.equal(singleOutfit["pose-sample"], undefined);
  assert.equal(singleOutfit.outfit.inputs.image, "{{image2}}");
  assert.deepEqual(singleOutfit["outfit-encode"].inputs["images.image_1"], ["person", 0]);
  assert.match(singleOutfit["outfit-encode"].inputs.prompt, /brown leather boots/);
  const poseLora = "qwen/VNCCS_QI2_PoseStudioV1.1.safetensors";
  const both = bind({ person, pose, outfit }, { poseModel: "qwen/pose-bf16.safetensors", poseLora, cache: true });
  assert.equal(both.outfit.inputs.image, "{{image3}}");
  assert.equal(both["outfit-sample"], undefined);
  assert.equal(both.model.inputs.unet_name, "qwen/pose-bf16.safetensors");
  assert.deepEqual(both.poseLora.inputs, { model: ["model", 0], lora_name: poseLora, strength_model: 1 });
  assert.deepEqual(both.modelCache.inputs.model, ["poseLora", 0]);
  assert.deepEqual(both["pose-sample"].inputs.model, ["modelCache", 0]);
  assert.deepEqual(both["pose-encode"].inputs["images.image_1"], ["pose", 0]);
  assert.deepEqual(both["pose-encode"].inputs["images.image_2"], ["person", 0]);
  assert.deepEqual(both["pose-encode"].inputs["images.image_3"], ["outfit", 0]);
  assert.match(both["pose-encode"].inputs.prompt, /背部后仰・双手撩发/);
  assert.match(both["pose-encode"].inputs.prompt, /brown leather boots/);
  assert.deepEqual(both.out.inputs.images, ["pose-decode", 0]);
  assert.equal(bind({ person, outfit }, { poseLora }).poseLora, undefined);
  assert.deepEqual(bind({ person, pose }, { poseLora })["pose-sample"].inputs.model, ["poseLora", 0]);
  for (const graph of [singlePose, singleOutfit, both])
    for (const n of Object.values(graph))
      for (const input of Object.values(n.inputs))
        if (Array.isArray(input)) assert.ok(graph[input[0]]);
});
