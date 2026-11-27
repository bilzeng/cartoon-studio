import { makeId, makeNode } from "./studio.js";
import { referenceTypes } from "./storyboard.js";

export const writers = {
  reversal: {
    name: "逆袭打脸",
    hint: "被低估的人，亲手改写局面",
    prompt:
      "把人物置于公开的误判或不对等关系中。开头用一个动作交代主角会失去什么。让主角主动选择，用前文埋过的事实扭转局面。给对手可信的动机，反转后留下新的代价。",
  },
  mystery: {
    name: "悬疑推理",
    hint: "伏笔、误导与公平揭晓",
    prompt:
      "从异常的具体细节切入。安排观众看得见却可能误读的线索，每次发现都改变人物的判断。揭晓时让早先的细节获得新的含义。",
  },
  period: {
    name: "古装穿越",
    hint: "时代错位与身份博弈",
    prompt:
      "从现代经验与旧时代规矩之间的矛盾入戏。让衣食、称谓和场景细节服务剧情。主角的优势有局限，时代中的其他人也有判断力。",
  },
  comedy: {
    name: "轻喜剧",
    hint: "生活误会与节奏回扣",
    prompt:
      "给人物一个认真而具体的小目标。让信息差引发误会，将同一个细节以不同含义重复，结尾以动作或一句短对白回扣开场。",
  },
  drama: {
    name: "现实情感",
    hint: "克制的对白与关系变化",
    prompt:
      "以日常选择显现人物关系。用潜台词、停顿与细微动作承载情绪。冲突双方都有自己的立场，让结尾的变化可以在画面中被看见。",
  },
  fantasy: {
    name: "奇幻冒险",
    hint: "世界规则与抉择的代价",
    prompt:
      "用一个能被镜头呈现的事件揭示世界规则。赋予能力明确代价，让伙伴和对手作出不同选择。高潮兑现已建立的规则并改变人物关系。",
  },
  custom: { name: "自定义编剧", hint: "使用自己的编剧提示词", prompt: "" },
};
export const writingStages = [
  ["ideas", "故事梗概"],
  ["outline", "章节大纲"],
  ["script", "章节剧本"],
  ["assets", "资产设定"],
  ["shots", "分镜表"],
];
export const writingActions = {
  chat: "讨论想法",
  ideas: "生成三版梗概",
  concept: "修改选定梗概",
  outline: "生成章节大纲",
  extend: "续写后续章节大纲",
  script: "扩写本章",
  assets: "整理本章资产",
  shots: "生成本章分镜",
  shot: "改写这一镜",
};
export const conceptFields = {
  title: "片名",
  hook: "开场钩子",
  summary: "故事梗概",
  appeal: "核心看点与追看理由",
};
export const assetFields = { name: "资产名称", description: "设定与一致性细节", prompt: "资产绘图提示词" };
export const takeFields = {
  title: "镜头名称",
  framing: "景别",
  visual: "画面",
  camera: "运镜",
  dialogue: "对白／声音",
  imagePrompt: "分镜绘图提示词",
  videoPrompt: "分镜视频提示词",
};
export const activeConcept = (draft) => draft.ideas.find((idea) => idea.id === draft.selectedId);
export const maxWritingChapters = 60;
export function continuationRange(written, target) {
  if (!written || written >= maxWritingChapters) return null;
  const first = written + 1;
  return { first, last: Math.min(maxWritingChapters, Math.max(first, target)) };
}
export function chapterRangeLabel({ first, last }) {
  return "第 " + (first === last ? first : first + "–" + last) + " 章";
}
// Messages are already persisted. Older drafts can recover the author's notes without migration.
export function isAuthorNote(message) {
  return message.role === "user" && (message.authored ?? message.text !== writingActions[message.action]);
}
export function writingScope(message) {
  if (!message.ideaId) return "全剧";
  if (["ideas", "concept", "outline", "extend"].includes(message.action)) return "所选梗概";
  if (message.shotId) return "单镜";
  return message.chapterId ? "本章" : "所选梗概";
}
export function storyMemory(draft) {
  const saved = draft.storyMemory;
  const additions = [];
  for (const [index, message] of draft.messages.entries()) {
    if (index < (saved?.through || 0) || writingScope(message) !== "全剧" || !isAuthorNote(message)) continue;
    if (index === 0 && message.text === draft.brief) continue;
    additions.push(message.text);
  }
  return { premise: saved?.text ?? draft.brief, additions };
}
export function chapterBoard(idea, chapter) {
  const number = idea.chapters.findIndex((c) => c.id === chapter.id) + 1;
  const name = (idea.title + " · 第" + number + "章 " + chapter.title).slice(0, 100);
  const script = makeNode("script", { x: 0, y: 0 }, { title: chapter.title, text: chapter.script });
  const nodes = [script],
    edges = [],
    order = [];
  const assetNodes = new Map();
  const connect = (source, target) => edges.push({ id: makeId(), source, target });
  const referenceCards = chapter.assets.map((asset, i) => {
    const node = makeNode(
      "image",
      { x: 0, y: (i + 1) * 280 },
      {
        title: referenceTypes[asset.type] + " · " + asset.name,
        text: asset.prompt,
      },
    );
    nodes.push(node);
    assetNodes.set(asset.id, node.id);
    return { id: asset.id, type: asset.type, name: asset.name, description: asset.description };
  });
  for (const [i, take] of chapter.shots.entries()) {
    const y = i * 280;
    const shot = makeNode(
      "shot",
      { x: 1440, y },
      {
        title: take.title,
        text: take.visual,
        duration: take.duration,
        framing: take.framing,
        camera: take.camera,
        dialogue: take.dialogue,
        emptyCast: !!take.emptyCast,
        referenceIds: take.assetIds,
        imagePrompt: take.imagePrompt,
        videoPrompt: take.videoPrompt,
      },
    );
    const image = makeNode(
      "image",
      { x: 480, y },
      { title: take.title + " · 分镜图", text: take.imagePrompt },
    );
    const video = makeNode(
      "video",
      { x: 960, y },
      {
        title: take.title + " · 视频",
        text: take.videoPrompt,
        duration: take.duration,
        sourceShotId: shot.id,
      },
    );
    nodes.push(image, video, shot);
    order.push(shot.id);
    for (const id of take.assetIds) connect(assetNodes.get(id), image.id);
    connect(image.id, video.id);
    connect(script.id, shot.id);
    connect(video.id, shot.id);
    connect(image.id, shot.id);
  }
  return { name, nodes, edges, order, referenceCards };
}
