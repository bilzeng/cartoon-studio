import assert from "node:assert/strict";
import test from "node:test";
import { assetCatalog, mediaFileTags, updatedAssetUsage } from "../server/asset-library.mjs";

test("无语义文件名的 PNG 可从 ComfyUI 元数据提取角色卡标签，排除负面提示", () => {
  const header = Buffer.from("89504e470d0a1a0a0000000d4948445200000a00000005a0080200000000000000", "hex");
  const prompt = Buffer.from("prompt\0" + JSON.stringify({
    1: { class_type: "CharacterAssetCardTypography" },
    2: { class_type: "CLIPTextEncode", inputs: { text: "landscape" } },
    3: { class_type: "KSampler", inputs: { negative: ["2", 0] } },
  }));
  const chunk = Buffer.alloc(12 + prompt.length);
  chunk.writeUInt32BE(prompt.length);
  chunk.write("tEXt", 4);
  prompt.copy(chunk, 8);
  assert.deepEqual(mediaFileTags("image", Buffer.concat([header, chunk])), ["角色卡", "角色", "横图"]);
  assert.deepEqual(mediaFileTags("image", Buffer.concat([header, chunk.subarray(0, 25)])), ["横图"]);
  assert.deepEqual(mediaFileTags("image", Buffer.from("png")), []);
});

test("历史引用可回填使用时间，移动和移除节点保留时间，再次添加才更新", () => {
  const old = { updated: "2026-01-01", referenceCards: [{ type: "prop", id: "p", imageId: "img" }], nodes: [] };
  const board = { ...old, nodes: [{ id: "a", data: { assetId: "vid" } }] };
  board.assetUsage = updatedAssetUsage(old, board, "2026-02-01");
  assert.deepEqual(board.assetUsage, { img: old.updated, vid: "2026-02-01" });
  assert.deepEqual(updatedAssetUsage(board, { ...board, nodes: [] }, "2026-03-01"), board.assetUsage);
  assert.deepEqual(updatedAssetUsage(board, board, "2026-04-01"), board.assetUsage);
  assert.equal(updatedAssetUsage(board, { ...board, nodes: [{ id: "b", data: { assetId: "vid" } }] }, "2026-05-01").vid, "2026-05-01");
  const rows = assetCatalog([{ id: "img", name: "A", file: "a.png", kind: "image" },
    { id: "vid", name: "分镜", file: "v.mp4", kind: "video" },
    { id: "audio", name: "背景音乐", kind: "audio", file: "a.wav" }],
    [{ board }], [{ inputAssetIds: ["audio"], created: "2026-06-01" }], ["vid"]);
  assert.ok(rows[0].tags.includes("道具"));
  assert.ok(rows[1].favorite && rows[1].tags.includes("分镜"));
  assert.ok(rows[2].tags.includes("音乐") && rows[2].tags.includes("WAV"));
  assert.equal(rows[2].lastUsed, "2026-06-01");
});
