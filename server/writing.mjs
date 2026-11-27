import { mkdir, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { dataDir, editJson, readJson, settings } from "./files.mjs";
import { fail, readProject, saveProject, validateBoard } from "./storage.mjs";
import { requestCompletion } from "./prompt-optimizer.mjs";
import { applyReply, config, editContent, modelInput, string } from "./writing-content.mjs";
import { activeConcept, chapterBoard, writingActions } from "../shared/writing.js";

const directory = path.join(dataDir, "writing");
const running = new Set();
export const writingInProgress = () => running.size > 0;
function file(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw fail("剧本不存在", 404);
  return path.join(directory, id + ".json");
}
const expired = (task) => task && Date.now() - task.started > 240000;
async function change(id, fn) {
  return editJson(file(id), null, async (draft) => {
    if (!draft) throw fail("剧本不存在", 404);
    await fn(draft);
    draft.revision++;
    draft.updated = new Date().toISOString();
    return draft;
  });
}
async function read(id) {
  const draft = await readJson(file(id), null);
  if (!draft) throw fail("剧本不存在", 404);
  if (!expired(draft.task)) return draft;
  return change(id, (current) => {
    if (expired(current.task)) {
      current.task = null;
      current.error = "上次编写中断，已保留原稿，可以重新提交。";
    }
  });
}
function editable(draft, revision) {
  if (draft.task && !expired(draft.task)) throw fail("编剧正在处理上一轮请求", 409);
  if (revision !== draft.revision) throw fail("另一个窗口已更新剧本，请重新读取后再保存", 409);
  draft.task = null;
}
async function finish(id, task, input, profile) {
  try {
    const output = await requestCompletion(profile, input.system, input.user);
    await change(id, (draft) => {
      if (draft.task?.id !== task.id) return;
      let text;
      try {
        text = applyReply(draft, task, output);
      } catch (error) {
        throw fail(
          "模型回复格式有误，原稿已保留。" + (error.status ? error.message : "请重试或切换模型。"),
          502,
        );
      }
      draft.messages.push({
        role: "assistant",
        text,
        action: task.action,
        ideaId: draft.selectedId,
        chapterId: task.chapterId,
        shotId: task.shotId,
      });
      draft.task = null;
    });
  } catch (error) {
    await change(id, (draft) => {
      if (draft.task?.id === task.id) {
        draft.error = error.message;
        draft.task = null;
      }
    });
  } finally {
    running.delete(task.id);
  }
}
export function registerWriting(api) {
  api.get("/writing", async (_req, res) => {
    await mkdir(directory, { recursive: true });
    const files = (await readdir(directory)).filter((f) => /^[a-f0-9-]{36}\.json$/.test(f));
    const items = await Promise.all(
      files.map(async (f) => {
        const { id, name, style, brief, updated, ideas, selectedId } = await readJson(
          path.join(directory, f),
        );
        return {
          id,
          name,
          style,
          brief: brief.slice(0, 100),
          updated,
          chapters: ideas.find((i) => i.id === selectedId)?.chapters.length || 0,
        };
      }),
    );
    res.json(items.sort((a, b) => b.updated.localeCompare(a.updated)));
  });
  api.post("/writing", async (req, res) => {
    const input = req.body || {},
      setup = config(input);
    const brief = string(input.brief, "故事创意", 6000);
    const id = randomUUID();
    await mkdir(directory, { recursive: true });
    const draft = await editJson(file(id), null, () => ({
      ...setup,
      id,
      brief,
      updated: new Date().toISOString(),
      revision: 1,
      ideas: [],
      selectedId: "",
      messages: [],
      task: null,
      error: "",
    }));
    res.status(201).json(draft);
  });
  api.get("/writing/:id", async (req, res) => res.json(await read(req.params.id)));
  api.patch("/writing/:id", async (req, res) =>
    res.json(
      await change(req.params.id, (draft) => {
        editable(draft, req.body?.revision);
        editContent(draft, req.body);
      }),
    ),
  );
  api.post("/writing/:id/generate", async (req, res) => {
    const { action, profileId, note = "", revision } = req.body || {};
    const chapterId = ["ideas", "outline", "concept"].includes(action) ? undefined : req.body.chapterId;
    const shotId = action === "chat" || action === "shot" ? req.body.shotId : undefined;
    const message = string(note, "创作要求", 6000, action !== "chat");
    const profile = (await settings()).promptModels?.find((p) => p.id === profileId);
    if (!profile) throw fail("请先在「提示词模型」中配置编剧使用的模型");
    const task = { id: randomUUID(), action, chapterId, shotId, started: Date.now() };
    let input;
    const draft = await change(req.params.id, (d) => {
      editable(d, revision);
      input = modelInput(d, action, chapterId, shotId, message);
      d.task = task;
      d.error = "";
      d.messages.push({
        role: "user",
        text: message || writingActions[action],
        authored: !!message,
        action,
        ideaId: d.selectedId,
        chapterId,
        shotId,
      });
    });
    running.add(task.id);
    void finish(draft.id, task, input, profile).catch((e) => console.error("保存编剧任务失败", e.message));
    res.status(202).json(draft);
  });
  api.post("/writing/:id/import", async (req, res) => {
    let projectId;
    const draft = await change(req.params.id, async (d) => {
      editable(d, req.body?.revision);
      const idea = activeConcept(d);
      const chapter = idea?.chapters.find((c) => c.id === req.body.chapterId);
      if (!chapter?.shots.length || !chapter.script || !chapter.assets.length)
        throw fail("请先完成本章剧本、资产和分镜");
      if (chapter.review.length) throw fail("请先复核上游改动涉及的内容");
      if (chapter.shots.reduce((sum, s) => sum + s.duration, 0) !== chapter.seconds)
        throw fail("分镜总时长须与本章目标一致");
      const { id, title, summary, seconds, script, assets, shots } = chapter;
      // The same draft version always resolves to the same board, even after a lost response.
      const digest = createHash("sha256")
        .update(
          JSON.stringify([d.id, idea.id, idea.title, id, title, summary, seconds, script, assets, shots]),
        )
        .digest("hex");
      projectId = "writer-" + digest.slice(0, 40);
      try {
        await readProject(projectId);
      } catch (error) {
        if (error.status !== 404) throw error;
        await saveProject(projectId, await validateBoard(chapterBoard(idea, chapter)), 0);
      }
      chapter.projectId = projectId;
    });
    res.json({ projectId, draft });
  });
}
