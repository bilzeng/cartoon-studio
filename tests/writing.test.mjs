import assert from "node:assert/strict";
import test from "node:test";
import { applyReply, config, editContent, modelInput } from "../server/writing-content.mjs";
import { shotWorkflowValues } from "../shared/storyboard.js";
import { activeConcept } from "../shared/writing.js";

test("视频工作流采用导入镜头时长，尊重模型上限及手动覆盖值", () => {
  const model = { durationKey: "sec", controls: ["sec"], fields: [{ key: "sec", min: 1, max: 10 }] };
  const clip = { sourceShotId: "shot1", duration: 14 };
  assert.deepEqual(shotWorkflowValues(clip, model), { sec: 10 });
  assert.deepEqual(shotWorkflowValues({ ...clip, workflowValues: { sec: 3 } }, model), { sec: 3 });
  assert.equal(shotWorkflowValues({ duration: 6 }, model), undefined);
});
test("同一梗概重做大纲时保留已写的章节，新篇幅及自定义风格传入模型", () => {
  const draft = {
    ...config({ name: "雪夜", style: "custom", direction: "只用短对白", count: 1, seconds: 20 }),
    brief: "有人在等车",
    ideas: [],
    messages: [],
    selectedId: "",
  };
  const idea = {
    title: "等车",
    summary: "两个人等末班车。",
    hook: "车来了又走。",
    appeal: "陌生人认出了对方。",
  };
  const first = { title: "站台", summary: "第一次擦肩" };
  applyReply(
    draft,
    { action: "ideas" },
    JSON.stringify({ ideas: [idea, { ...idea, title: "迷路" }, { ...idea, title: "再见" }] }),
  );
  editContent(draft, { action: "select", id: draft.ideas[0].id });
  applyReply(draft, { action: "outline" }, JSON.stringify({ chapters: [first] }));
  const old = activeConcept(draft).chapters[0];
  applyReply(
    draft,
    { action: "script", chapterId: old.id },
    JSON.stringify({ script: "站台。她把手从口袋里抽出来。" }),
  );
  editContent(draft, { action: "settings", value: { ...draft, seconds: 35 } });
  const input = modelInput(draft, "outline", old.id, null, "从车内开场");
  assert.match(input.system, /只用短对白/);
  assert.equal(JSON.parse(input.user).每章目标秒数, 35);
  applyReply(
    draft,
    { action: "outline", chapterId: old.id },
    JSON.stringify({ chapters: [{ ...first, title: "车内" }] }),
  );
  assert.notEqual(draft.selectedId, draft.ideas[0].id);
  assert.equal(activeConcept(draft).chapters[0].seconds, 35);
  editContent(draft, { action: "select", id: draft.ideas[0].id });
  assert.equal(activeConcept(draft).chapters[0].seconds, 20);
  assert.match(activeConcept(draft).chapters[0].script, /口袋/);
  assert.throws(() => config({ ...draft, style: "custom", direction: "" }), /风格提示词/);
});

test("正文或资产修改会标明后续待复核，同名资产重写继续使用原引用", () => {
  const chapter = { id: "chapter", seconds: 12, script: "旧稿", assets: [], shots: [], review: [] };
  const idea = { id: "idea", chapters: [chapter] };
  const draft = { selectedId: "idea", ideas: [idea] };
  const assets = [{ name: "票夹", type: "prop", description: "红票夹", prompt: "红色旧皮票夹，白底" }];
  const apply = (action, value) =>
    applyReply(draft, { action, chapterId: chapter.id }, JSON.stringify(value));
  apply("assets", { assets });
  const assetId = chapter.assets[0].id;
  const take = {
    title: "票夹",
    duration: 5,
    framing: "特写",
    visual: "手打开票夹",
    camera: "固定",
    dialogue: "",
    imagePrompt: "手里的票夹",
    videoPrompt: "手打开票夹",
    assetIds: ["A1"],
  };
  apply("shots", { shots: [take, take] });
  assert.deepEqual(
    chapter.shots.map((s) => s.duration),
    [6, 6],
  );
  assert.deepEqual(chapter.shots[0].assetIds, [assetId]);
  editContent(draft, { action: "script", chapterId: "chapter", value: "票夹滑落到地上。" });
  assert.deepEqual(chapter.review, ["assets", "shots"]);
  apply("assets", { assets: [{ ...assets[0], prompt: "磨损的皮票夹" }] });
  assert.equal(chapter.assets[0].id, assetId);
  assert.deepEqual(chapter.review, ["shots"]);
  assert.throws(() => apply("shots", { shots: [{ ...take, assetIds: ["A2"] }] }), /未知/);
  assert.equal(chapter.shots.length, 2);
  editContent(draft, { action: "review", chapterId: "chapter", value: "shots" });
  assert.deepEqual(chapter.review, []);
});
