import assert from "node:assert/strict";
import test from "node:test";
import { applyReply, config, editContent, modelInput } from "../server/writing-content.mjs";
import { shotPrompt, shotWorkflowValues } from "../shared/storyboard.js";
import { activeConcept, chapterBoard } from "../shared/writing.js";

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
  draft.messages.push({
    role: "user",
    action: "outline",
    text: "主角是司机",
    ideaId: draft.selectedId,
    chapterId: old.id,
  });
  const input = modelInput(draft, "outline", old.id, null, "从车内开场");
  assert.match(input.system, /只用短对白/);
  assert.equal(JSON.parse(input.user).每章目标秒数, 35);
  applyReply(
    draft,
    { action: "outline", chapterId: old.id },
    JSON.stringify({ chapters: [{ ...first, title: "车内" }] }),
  );
  draft.messages.push({
    role: "user",
    action: "concept",
    text: "原案后来改成售票员",
    ideaId: draft.ideas[0].id,
  });
  const notes = JSON.parse(
    modelInput(draft, "script", activeConcept(draft).chapters[0].id).user,
  ).当前选稿的作者留言;
  assert.deepEqual(
    notes.map((n) => n.原话),
    ["主角是司机"],
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
  draft.error = "模型服务响应超时";
  draft.messages = [{ role: "user", action: "script", ideaId: idea.id, chapterId: chapter.id }];
  editContent(draft, { action: "script", chapterId: "chapter", value: "票夹滑落到地上。" });
  assert.equal(draft.error, "");
  assert.deepEqual(chapter.earlierScripts, ["旧稿"]);
  assert.deepEqual(chapter.review, ["assets", "shots"]);
  apply("assets", { assets: [{ ...assets[0], prompt: "磨损的皮票夹" }] });
  assert.equal(chapter.assets[0].id, assetId);
  assert.deepEqual(chapter.review, ["shots"]);
  assert.throws(() => apply("shots", { shots: [{ ...take, assetIds: ["A2"] }] }), /未知/);
  assert.equal(chapter.shots.length, 2);
  editContent(draft, { action: "review", chapterId: "chapter", value: "shots" });
  assert.deepEqual(chapter.review, []);
});

test("正文中的空镜与无言反应按原时长进入画布，漏拆或错序保留已有分镜", () => {
  const chapter = {
    id: "c", title: "末班车", seconds: 20, summary: "他目送车离站。",
    script: "【空镜 4秒】空站台，只听见远去的车声。\n【反应·3秒】他握紧车票。",
    assets: [{ id: "p", type: "character", name: "乘客" }, { id: "s", type: "scene", name: "站台" }],
    shots: [], review: [],
  };
  const idea = { id: "i", title: "归途", hook: "车门合上", appeal: "车上有封信", summary: "目送末班车", chapters: [chapter] };
  const draft = { selectedId: "i", style: "drama", brief: "等车", messages: [], ideas: [idea] };
  const { user } = modelInput(draft, "shots", chapter.id);
  assert.deepEqual(JSON.parse(user).当前章.留白节拍.map((b) => [b.id, b.seconds]), [["B1", 4], ["B2", 3]]);
  const take = {
    title: "站台", duration: 5, framing: "远景", visual: "空站台", camera: "固定", dialogue: "车声",
    assetIds: ["A1", "A2"], imagePrompt: "空站台，暮色", videoPrompt: "空站台，末班车的声音渐远",
  };
  const apply = (shots) => applyReply(draft, { action: "shots", chapterId: chapter.id }, JSON.stringify({ shots }));
  apply([{ ...take, beatId: "B1" }, { ...take, beatId: "B2" }, take]);
  assert.deepEqual(chapter.shots.map((s) => s.duration), [4, 3, 13]);
  const board = chapterBoard(idea, chapter);
  const [cutaway, reaction] = board.order.map((id) => board.nodes.find((n) => n.id === id));
  assert.deepEqual(cutaway.data.referenceIds, ["s"]);
  assert.deepEqual(reaction.data.referenceIds, ["p", "s"]);
  board.series = { cast: "红衣乘客" };
  assert.match(shotPrompt(board, cutaway.data), /空镜，无人出场/);
  assert.doesNotMatch(shotPrompt(board, cutaway.data), /红衣乘客/);
  assert.equal(board.nodes.find((n) => n.data.sourceShotId === cutaway.id).data.duration, 4);
  const previous = chapter.shots;
  assert.throws(() => apply([take]), /遗漏/);
  assert.throws(() => apply([{ ...take, beatId: "B2" }]), /顺序/);
  assert.equal(chapter.shots, previous);
});

test("旧稿的作者纠正跨轮保留，未选备选与自动回执不成为剧情依据", () => {
  const correction = "写错了，他离开的原因是缺钱。靠修第一台收音机起步，最后开自己的店。";
  const proposal = {
    title: "卧底之谜",
    hook: "门缝里有暗号",
    summary: "邮差其实是卧底",
    appeal: "暗号来自谁",
  };
  const draft = {
    ...config({ name: "回声", style: "drama", direction: "", count: 1, seconds: 60 }),
    brief: "他因下雨离开镇子。",
    ideas: [],
    messages: [],
    selectedId: "",
  };
  applyReply(
    draft,
    { action: "ideas" },
    JSON.stringify({ ideas: [proposal, { ...proposal, title: "月台" }, { ...proposal, title: "高楼" }] }),
  );
  draft.messages = [
    { role: "user", action: "ideas", text: draft.brief },
    { role: "assistant", action: "ideas", text: "写好了《卧底之谜》。" },
    { role: "user", action: "ideas", text: correction },
    ...Array.from({ length: 20 }, (_, i) => ({ role: "assistant", action: "chat", text: "讨论对白" + i })),
    { role: "user", action: "ideas", text: "生成三版梗概" },
  ];
  const context = (action, note = "", chapterId) =>
    JSON.parse(modelInput(draft, action, chapterId, undefined, note).user);
  const fresh = context("ideas");
  assert.equal(fresh.作者设定, draft.brief);
  assert.deepEqual(fresh.作者历次补充, [correction]);
  assert.equal(fresh.最近对话.length, 12);
  assert.equal(fresh.作者片名, "回声");
  assert.doesNotMatch(JSON.stringify(fresh), /卧底/);
  assert.equal(context("ideas", "上轮方案写错了，请按最新要求重来").供讨论或点名参考的备选, undefined);
  for (const note of ["只沿用方案2的地点", "参考第二个梗概的开头", "保留《月台》的地点"])
    assert.deepEqual(
      context("ideas", note).供讨论或点名参考的备选.map((x) => x.方案编号),
      [2],
    );
  assert.equal(context("chat").供讨论或点名参考的备选.length, 3);
  const cutoff = draft.messages.length;
  draft.messages.push({ role: "user", action: "ideas", authored: true, text: "把店铺设在码头。" });
  editContent(draft, {
    action: "memory",
    value: { premise: "修理工因缺钱离乡，靠修收音机开店。", through: cutoff },
  });
  assert.deepEqual(context("ideas").作者历次补充, ["把店铺设在码头。"]);
  assert.doesNotMatch(JSON.stringify(context("ideas")), /下雨|卧底|讨论对白/);
  editContent(draft, { action: "select", id: draft.ideas[1].id });
  applyReply(
    draft,
    { action: "outline" },
    JSON.stringify({ chapters: [{ title: "街角", summary: "第一次修理" }] }),
  );
  const chapter = activeConcept(draft).chapters[0];
  chapter.script = "他推开修理铺的门。";
  chapter.assets = [{ id: "a", name: "一把旧钥匙", type: "prop", description: "黄铜" }];
  for (const action of ["outline", "script", "assets", "shots"]) {
    const ctx = context(action, "", chapter.id);
    assert.match(ctx.作者设定, /缺钱/);
    assert.deepEqual(ctx.作者历次补充, ["把店铺设在码头。"]);
    assert.equal(ctx.供讨论或点名参考的备选, undefined);
  }
});
