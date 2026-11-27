import {
  activeConcept,
  assetFields,
  conceptFields,
  isAuthorNote,
  writingScope,
  storyMemory,
  takeFields,
  writers,
  writingActions,
} from "../shared/writing.js";
import { referenceTypes } from "../shared/storyboard.js";
import { fail } from "./storage.mjs";

export function string(value, label, max, optional = false) {
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim()))
    throw fail(label + "须为" + (optional ? "不超过" : "1 至") + max + "字的文本");
  return value.trim();
}
function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw fail(label + "须在 " + min + " 至 " + max + " 之间");
  return value;
}
export function config(input) {
  if (!Object.hasOwn(writers, input.style)) throw fail("请选择编剧风格");
  return {
    name: string(input.name, "剧本名称", 100),
    style: input.style,
    direction: string(input.direction || "", "编剧风格提示词", 4000, input.style !== "custom"),
    count: integer(input.count, "章节数", 1, 60),
    seconds: integer(input.seconds, "每章目标秒数", 5, 300),
  };
}
function fields(row, labels, limits) {
  return Object.fromEntries(
    Object.entries(labels).map(([key, label]) => [
      key,
      string(row?.[key], label, limits[key] || 1500, key === "dialogue"),
    ]),
  );
}
function rows(value, label, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw fail(label + "数量应为 " + min + (min === max ? "" : " 至 " + max));
  return value;
}
const ideaText = (value) => fields(value, conceptFields, { title: 80, summary: 4000 });
const outlineText = (value) =>
  fields(value, { title: "章节名", summary: "章节提要" }, { title: 100, summary: 3000 });
function assetText(value) {
  if (!Object.hasOwn(referenceTypes, value?.type)) throw fail("资产类别无效");
  return { type: value.type, ...fields(value, assetFields, { name: 100, prompt: 4000 }) };
}
function takeText(value, chapter) {
  const ids = rows(value?.assetIds, "镜头引用", 0, chapter.assets.length);
  if (ids.some((id) => !chapter.assets.some((a) => a.id === id)) || ids.length !== new Set(ids).size)
    throw fail("镜头引用了未知或重复的资产编号");
  return {
    ...fields(value, takeFields, { title: 90, visual: 3000, imagePrompt: 4000, videoPrompt: 4000 }),
    duration: integer(value.duration, "单镜秒数", 1, 30),
    emptyCast: value.emptyCast === true,
    assetIds: value.emptyCast === true
      ? ids.filter((id) => chapter.assets.some((asset) => asset.id === id && asset.type !== "character"))
      : ids,
  };
}
// Give the model short references, while the draft and canvas keep permanent asset IDs.
function modelTake(take, chapter) {
  const ids = take?.assetIds;
  if (!Array.isArray(ids)) throw fail("分镜缺少资产引用列表");
  return takeText(
    {
      ...take,
      assetIds: ids.map((id) => {
        const match = /^A([1-9]\d*)$/.exec(id);
        return match ? chapter.assets[Number(match[1]) - 1]?.id : id;
      }),
    },
    chapter,
  );
}
function balanceDurations(shots, seconds) {
  const sum = shots.reduce((total, s) => total + s.duration, 0);
  if (sum === seconds) return;
  if (seconds < shots.length || seconds > 30 * shots.length) throw fail("镜头数量无法覆盖本章时长");
  const ideal = shots.map((s) => (s.duration * seconds) / sum);
  shots.forEach((s, i) => {
    s.duration = Math.max(1, Math.min(30, Math.floor(ideal[i])));
  });
  let difference = seconds - shots.reduce((total, s) => total + s.duration, 0);
  while (difference) {
    const step = Math.sign(difference);
    let best = -1,
      priority = -Infinity;
    shots.forEach((s, i) => {
      const remainder = step * (ideal[i] - s.duration);
      if (s.duration + step >= 1 && s.duration + step <= 30 && remainder > priority) {
        best = i;
        priority = remainder;
      }
    });
    shots[best].duration += step;
    difference -= step;
  }
}

function timedBeats(script) {
  const pattern = /^[ \t]*【(空镜|反应)[ ·・：:\t]*(\d+)[ \t]*秒】[ \t]*(.*)$/gmu;
  return Array.from(script.matchAll(pattern), ([, kind, seconds, cue], index) => ({
    id: "B" + (index + 1),
    kind,
    seconds: Number(seconds),
    cue,
  }));
}

function chapterShots(values, chapter) {
  const beats = timedBeats(chapter.script);
  const flexible = [];
  let used = 0;
  let remaining = chapter.seconds;
  const shots = rows(values, "分镜", 1, 30).map((value) => {
    const beat = value?.beatId ? beats[used] : undefined;
    if (value?.beatId && beat?.id !== value.beatId) throw fail("请按正文顺序为每处留白安排一镜");
    const shot = {
      ...modelTake(beat ? { ...value, duration: beat.seconds, emptyCast: beat.kind === "空镜" } : value, chapter),
      id: crypto.randomUUID(),
    };
    if (beat) {
      used++;
      remaining -= beat.seconds;
    } else flexible.push(shot);
    return shot;
  });
  if (used !== beats.length) throw fail("分镜遗漏了正文中标时的留白");
  if (beats.length && (remaining < flexible.length || remaining > flexible.length * 30))
    throw fail("按正文留出停顿后，其余镜头数量无法覆盖剩余时长");
  balanceDurations(flexible, remaining);
  return shots;
}
function mark(chapter, ...stages) {
  for (const stage of stages)
    if (chapter[stage]?.length && !chapter.review.includes(stage)) chapter.review.push(stage);
}
function current(draft, chapterId) {
  const idea = activeConcept(draft);
  return { idea, chapter: idea?.chapters.find((c) => c.id === chapterId) };
}
export function editContent(draft, command) {
  const { action, value, id, chapterId } = command;
  if (action === "memory") {
    const through = integer(
      value?.through,
      "整理位置",
      draft.storyMemory?.through || 0,
      draft.messages.length,
    );
    draft.storyMemory = { text: string(value?.premise, "故事设定", 32000), through };
    return;
  }
  if (action === "settings") return Object.assign(draft, config(value));
  if (action === "select") {
    if (!draft.ideas.some((i) => i.id === id)) throw fail("梗概不存在");
    draft.selectedId = id;
    return;
  }
  if (action === "idea") {
    const item = draft.ideas.find((i) => i.id === id);
    if (!item) throw fail("梗概不存在");
    Object.assign(item, ideaText(value));
    for (const c of item.chapters) mark(c, "script", "assets", "shots");
    return;
  }
  const { chapter } = current(draft, chapterId);
  if (!chapter) throw fail("章节不存在");
  if (action === "chapter") {
    Object.assign(chapter, outlineText(value));
    mark(chapter, "script", "assets", "shots");
  } else if (action === "script") {
    const script = string(value, "剧本", 24000);
    if (chapter.script && chapter.script !== script) {
      chapter.earlierScripts ??= [];
      chapter.earlierScripts.push(chapter.script);
    }
    chapter.script = script;
    const last = draft.messages?.at(-1);
    if (draft.error && last?.action === "script" && last.ideaId === draft.selectedId && last.chapterId === chapterId)
      draft.error = "";
    mark(chapter, "assets", "shots");
    chapter.review = chapter.review.filter((s) => s !== "script");
  } else if (action === "asset") {
    const asset = chapter.assets.find((a) => a.id === id);
    if (!asset) throw fail("资产不存在");
    Object.assign(asset, assetText(value));
    mark(chapter, "shots");
  } else if (action === "shot") {
    const shot = chapter.shots.find((s) => s.id === id);
    if (!shot) throw fail("分镜不存在");
    Object.assign(shot, takeText(value, chapter));
  } else if (action === "review" && chapter.review.includes(value)) {
    chapter.review = chapter.review.filter((s) => s !== value);
  } else throw fail("未知的剧本编辑操作");
}
const formats = {
  chat: "结合对话和当前选稿，直接用中文回应作者，可以提出具体修改建议。只返回普通文本。",
  ideas:
    '在作者确定的人物关系、动机、起点和结局之内给出三种故事走向。用不同的切入场景、人物选择或叙事节奏产生差异。作者要写成长历程时，给出从起点到目标的关键选择与变化。每个方案写一个可拍的开场钩子、用三句话写清谁遇到什么和留下什么悬念，再给出核心看点及追看理由。返回 {"ideas":[{"title":"","hook":"","summary":"","appeal":""}]}。',
  concept: '按照修改要求仅修改选定梗概。返回 {"idea":{"title":"","hook":"","summary":"","appeal":""}}。',
  outline:
    '为选定梗概构建完整叙事弧，严格按目标章数输出。每章用一至三句交代起点、人物此刻相信什么、哪件事足以改变其判断、他因此怎样选择、留下什么后果。让关键转变占得下本章秒数；篇幅紧时删次要事件，多章可把后果留到下章。跨时交代经过多久及为何要等。返回 {"chapters":[{"title":"","summary":""}]}。',
  script:
    [
      "只扩写指定的一章。保留选稿的人物、事件与相邻章衔接，用场次、内外景、地点、时段、可拍到的动作和署名短对白写成剧本。",
      "把关键决定之前的过程演出来。重创过后，留给人物一个仍受上件事影响的日常动作。遇到难以置信的消息，写他最初怎样解释或拒绝、亲自核验了什么、哪个具体结果使他愿意冒这一次险。证据只够试探时，人物可以仍然半信半疑。按本章处境取舍。",
      "在情绪转折或时间流逝处，给有叙事作用的无人空镜或无言反应实际的银幕时间。单独起一行写【空镜 N秒】或【反应 N秒】和具体可见可听的内容，N 为 1 至 30 的整数。留住这几秒，不用旁白解释情绪。没有相应转折的短场景可直接推进。",
      "辨清故事里过了多久和观众实际看了多少秒。核对地点、昼夜和事件可发生的时段；遇到营业、开市、等人、等结果等条件，场头写下一个可行时点，用前后呼应的物件、声音或光线带过等待。按目标秒数给对白、动作和留白留足时间，删去重复刺激。",
      '返回 {"script":"完整多行剧本文本"}。',
    ].join("\n"),
  assets:
    '从当前章剧本提取实际出现的角色、场景和重要道具，按 type=character/scene/prop 分类。同一角色统一命名，延用前章设定。描述身份、目标及可辨识外观。保留承接情绪或时间变化的道具与场景，场景参考图只呈现空间、时段与光线，道具写材质与尺寸感。每项另写可独立生成参考图的视觉提示词，保持统一美术设定。最多24项。返回 {"assets":[{"type":"character","name":"","description":"","prompt":""}]}。',
  shots:
    "仅拆当前章。按节奏安排可拍的镜头，1至30个镜头，每镜1至30整数秒，各镜 duration 之和严格等于本章秒数。时间仅填 duration 字段，正文不重复写时间码。分镜交代景别、画面、运镜、对白或声音，引用本章已提供的资产ID。绘图提示词描述单帧构图、视觉锚点、光色和氛围；视频提示词给出起始画面、动作、运镜和声音。每条提示词可独立制作。",
  shot: "按作者要求只改指定的一镜，保留该镜原时长和相邻镜头的连续性。延续原有空镜或反应的作用与声画关系，除非作者要求改变它。使用已给的资产ID。",
};
const shotShape =
  '{"title":"","duration":5,"framing":"","visual":"","camera":"","dialogue":"","emptyCast":false,"assetIds":[],"imagePrompt":"","videoPrompt":""}';
function chapterContext(c) {
  return { title: c.title, summary: c.summary, seconds: c.seconds };
}
function referenceIdeas(ideas, action, note) {
  if (action !== "ideas" && action !== "chat") return;
  const named = new Set();
  // Use the same 1-based numbering as the manuscript cards, including for archived proposals.
  const digits = "零一二三四五六七八九";
  function numberOf(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const [tens, units] = value.replace("两", "二").split("十");
    return units === undefined
      ? digits.indexOf(tens)
      : (tens ? digits.indexOf(tens) : 1) * 10 + digits.indexOf(units || "零");
  }
  for (const match of note.matchAll(
    /(?:方案|梗概|选项|版本|option\s*|#)\s*([0-9一二两三四五六七八九十]+)|第\s*([0-9一二两三四五六七八九十]+)\s*(?:个|种|版|套|条|案|个?方案|个?梗概)/giu,
  )) {
    named.add(numberOf(match[1] || match[2]));
  }
  const references = ideas.flatMap((idea, i) =>
    named.has(i + 1) ||
    note.includes("《" + idea.title + "》") ||
    (idea.title.length >= 2 && note.includes(idea.title))
      ? [{ 方案编号: i + 1, ...ideaText(idea) }]
      : [],
  );
  if (references.length) return references;
  if (
    action === "chat" ||
    /(?:沿用|保留|结合|参考|修改|改写)(?:上一?轮|上一?版|这三[个版种]|前面|之前|刚才)/u.test(note)
  )
    return ideas
      .slice(-3)
      .map((idea, i, last) => ({ 方案编号: ideas.length - last.length + i + 1, ...ideaText(idea) }));
}

export function modelInput(draft, action, chapterId, shotId, note = "") {
  if (!Object.hasOwn(formats, action)) throw fail("未知的创作步骤");
  const { idea, chapter } = current(
    draft,
    ["ideas", "outline", "concept"].includes(action) ? null : chapterId,
  );
  if (!["chat", "ideas"].includes(action) && !idea) throw fail("请先选定一个故事梗概");
  if (["script", "assets", "shots", "shot"].includes(action) && !chapter) throw fail("请先选择章节");
  if (["assets", "shots", "shot"].includes(action) && !chapter.script) throw fail("请先扩写本章剧本");
  if (["shots", "shot"].includes(action) && !chapter.assets.length) throw fail("请先整理本章资产");
  const target = chapter?.shots.find((s) => s.id === shotId);
  const beats = action === "shots" ? timedBeats(chapter.script) : [];
  if (action === "shot" && !target) throw fail("请选择要修改的镜头");
  const format =
    formats[action] +
    (action === "shots"
      ? ' 返回 {"shots":[' + shotShape + "]}"
      : action === "shot"
        ? ' 返回 {"shot":' + shotShape + "}"
        : "");
  const system = [
    "你是镜场的签约编剧，与作者共同开发可实际拍摄的作品。",
    writers[draft.style].prompt,
    draft.direction,
    "先核对作者设定、历次作者补充和本轮要求。作者明确更正的动机、关系、起点、目标按时间以最新表述为准，未改动的事实继续有效。这些约束适用于每一个备选和后续制作。提问、试探和单镜要求只按原意及适用范围处理。",
    "未选梗概与编剧在讨论中提出的情节都属于备选。只有作者采纳或明确引用的部分可延续。即使是选稿，与作者后续明确纠正冲突的部分也须重写。编剧风格服从作者设定。",
    format,
    ["shots", "shot"].includes(action) &&
      "以当前章正文为拍摄依据。依原序保留余韵、验证与跨时过渡。无人空镜填 emptyCast=true，只写入画的环境、物件与原有声音，图像和视频提示词都要适合无人画面，引用仅限入画资产。无言反应把时间留在人物身上。",
    beats.length > 0 &&
      "当前章.留白节拍中的每一项各占一镜，按原顺序放在对应剧情位置。只在对应镜头增加 beatId 字段，原样填写 B1 等编号，duration 取该项 seconds。其余镜头分配本章剩余秒数。",
    action !== "chat" && "只输出要求的 JSON 对象。所有内容使用作者的语言。",
  ]
    .filter(Boolean)
    .join("\n");
  const otherAssets = new Map();
  for (const c of idea?.chapters || [])
    if (c.id !== chapterId)
      for (const a of c.assets)
        otherAssets.set(a.type + a.name, { type: a.type, name: a.name, description: a.description });
  const assets = chapter?.assets.map((a, i) => ({ ...a, id: "A" + (i + 1) }));
  const existingShot = (s) => ({
    ...s,
    assetIds: s.assetIds.map((id) => assets[chapter.assets.findIndex((a) => a.id === id)]?.id),
  });
  const memory = storyMemory(draft);
  // Inherit only the parent conversation that existed when this version branched.
  const branchLimits = new Map();
  let branch = idea,
    through = draft.messages.length;
  while (branch && !branchLimits.has(branch.id)) {
    branchLimits.set(branch.id, through);
    through = Math.min(through, branch.source?.through ?? 0);
    branch = branch.source && draft.ideas.find((item) => item.id === branch.source.id);
  }
  const localMessages = draft.messages.filter((m, i) => {
    const scope = writingScope(m);
    if (scope === "全剧" || i >= (branchLimits.get(m.ideaId) ?? 0)) return false;
    if (scope === "所选梗概") return true;
    return m.chapterId === chapter?.id && (scope === "本章" || m.shotId === shotId);
  });
  const localSet = new Set(localMessages);
  const recentChat = draft.messages.filter(
    (m, i) =>
      m.action === "chat" &&
      (localSet.has(m) || (writingScope(m) === "全剧" && i >= (draft.storyMemory?.through || 0))),
  );
  const references = referenceIdeas(draft.ideas, action, note);
  const user = JSON.stringify({
    作者片名: draft.name !== draft.brief.slice(0, 24) ? draft.name : undefined,
    目标章数: draft.count,
    每章目标秒数: chapter?.seconds ?? draft.seconds,
    作者设定: memory.premise,
    作者历次补充: memory.additions,
    当前选稿的作者留言: localMessages.filter(isAuthorNote).map((m) => ({
      范围: writingScope(m),
      原话: m.text,
    })),
    最近对话: recentChat.slice(-12).map(({ role, text }) => ({ role, text: text.slice(0, 4000) })),
    供讨论或点名参考的备选: references?.length ? references : undefined,
    选定梗概: idea && ideaText(idea),
    全剧章节: action !== "ideas" ? idea?.chapters.map(chapterContext) : undefined,
    上章结尾: chapter && idea.chapters[idea.chapters.indexOf(chapter) - 1]?.script.slice(-1800),
    全剧资产设定: action !== "ideas" ? [...otherAssets.values()].slice(0, 80) : undefined,
    当前章: chapter && {
      ...chapterContext(chapter),
      正文: chapter.script,
      留白节拍: beats.length ? beats : undefined,
      资产: assets,
      现有分镜: ["shots", "shot", "chat"].includes(action) ? chapter.shots.map(existingShot) : undefined,
    },
    指定镜头: target && existingShot(target),
    本轮任务: writingActions[action],
    作者要求: note,
  });
  return { system, user };
}

export function applyReply(draft, task, output) {
  const { action, chapterId, shotId } = task;
  if (action === "chat") return string(output, "编剧回复", 32000);
  const result = JSON.parse(output.trim().replace(/^`{3}(?:json)?\s*([\s\S]*?)\s*`{3}$/i, "$1"));
  const { idea, chapter } = current(draft, chapterId);
  if (action === "ideas") {
    const created = rows(result.ideas, "梗概", 3, 3).map((v) => ({
      ...ideaText(v),
      id: crypto.randomUUID(),
      chapters: [],
      source: idea ? { id: idea.id, through: draft.messages.length } : undefined,
    }));
    draft.ideas.push(...created);
    return "写好了三版梗概：" + created.map((i) => "《" + i.title + "》").join("、") + "。";
  }
  if (action === "concept") {
    editContent(draft, { action: "idea", id: idea.id, value: result.idea });
    return "已修改《" + idea.title + "》的梗概。";
  }
  if (action === "outline") {
    const chapters = rows(result.chapters, "章节", draft.count, draft.count).map((v) => ({
      ...outlineText(v),
      id: crypto.randomUUID(),
      seconds: draft.seconds,
      script: "",
      assets: [],
      shots: [],
      review: [],
    }));
    if (idea.chapters.length) {
      const branch = {
        ...ideaText(idea),
        id: crypto.randomUUID(),
        chapters,
        source: { id: idea.id, through: draft.messages.length },
      };
      draft.ideas.push(branch);
      draft.selectedId = branch.id;
    } else idea.chapters = chapters;
    return "已写好 " + chapters.length + " 章大纲，从《" + chapters[0].title + "》开始。";
  }
  if (action === "script") editContent(draft, { action, chapterId, value: result.script });
  if (action === "assets") {
    const assets = rows(result.assets, "资产", 1, 24).map(assetText);
    const keys = assets.map((a) => a.type + ":" + a.name);
    if (new Set(keys).size !== keys.length) throw fail("同类型资产重名");
    chapter.assets = assets.map((a) => ({
      ...a,
      id: chapter.assets.find((old) => old.name === a.name && old.type === a.type)?.id || crypto.randomUUID(),
    }));
    const ids = new Set(chapter.assets.map((a) => a.id));
    for (const s of chapter.shots) s.assetIds = s.assetIds.filter((id) => ids.has(id));
    mark(chapter, "shots");
  }
  if (action === "shots") {
    chapter.shots = chapterShots(result.shots, chapter);
  }
  if (action === "shot") {
    const original = chapter.shots.find((s) => s.id === shotId);
    Object.assign(original, modelTake({ emptyCast: original.emptyCast, ...result.shot, duration: original.duration }, chapter));
  }
  chapter.review = chapter.review.filter((s) => s !== action);
  return (
    "《" +
    chapter.title +
    "》" +
    {
      script: "的剧本已写好",
      assets: "已整理 " + chapter.assets.length + " 项资产",
      shots: "已拆成 " + chapter.shots.length + " 镜",
      shot: "的指定镜头已修改",
    }[action] +
    "。"
  );
}
