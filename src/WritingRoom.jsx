import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  ChevronDown,
  Clapperboard,
  Compass,
  Drama,
  Feather,
  FileText,
  Flame,
  LibraryBig,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Search,
  Send,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "./client";
import { Modal } from "./ui";
import { Select } from "./Select";
import { PromptModelSettings, useProfiles } from "./PromptOptimizer";
import {
  activeConcept,
  assetFields,
  conceptFields,
  storyMemory,
  takeFields,
  writers,
  writingActions,
  writingStages,
} from "../shared/writing";
import { referenceTypes } from "../shared/storyboard";
import "./writing.css";

const styleIcons = {
  reversal: Flame,
  mystery: Search,
  period: Compass,
  comedy: Drama,
  drama: Feather,
  fantasy: Sparkles,
  custom: Pencil,
};
const defaults = { name: "", style: "reversal", direction: "", count: 1, seconds: 60, brief: "" };
const limits = {
  premise: 32000,
  title: 80,
  hook: 1500,
  summary: 3000,
  appeal: 1500,
  name: 100,
  description: 1500,
  prompt: 4000,
  script: 24000,
  framing: 1500,
  visual: 3000,
  camera: 1500,
  dialogue: 1500,
  imagePrompt: 4000,
  videoPrompt: 4000,
};
function Setup({ value, onChange }) {
  const set = (key, v) => onChange({ ...value, [key]: v });
  function styleOption(key) {
    const { name, hint } = writers[key],
      Icon = styleIcons[key];
    const selected = value.style === key;
    return (
      <button
        key={key}
        type="button"
        data-genre={key}
        className={key === "custom" ? "wr-custom" : "wr-genre"}
        aria-label={name}
        aria-pressed={selected}
        onClick={() => set("style", key)}
      >
        <Icon size={key === "custom" ? 14 : 18} aria-hidden="true" />
        <span>
          <strong>{name}</strong>
          {key !== "custom" && <small>{hint}</small>}
        </span>
        {selected && <Check size={14} className="wr-tick" aria-hidden="true" />}
      </button>
    );
  }
  return (
    <>
      <div className="wr-section-heading">
        <h2>选择编剧</h2>
        {styleOption("custom")}
      </div>
      <div className="wr-styles">
        {Object.keys(writers)
          .filter((key) => key !== "custom")
          .map(styleOption)}
      </div>
      <details className="wr-style-note" key={value.style} open={value.style === "custom" || undefined}>
        <summary>{value.style === "custom" ? "自定义风格提示词" : "查看与补充风格提示词"}</summary>
        {writers[value.style].prompt && <p>{writers[value.style].prompt}</p>}
        <textarea
          aria-label="编剧风格提示词"
          rows={3}
          maxLength={4000}
          value={value.direction}
          onChange={(e) => set("direction", e.target.value)}
          placeholder="填入自己的编剧提示词，或补充对节奏、对白、叙事方式的要求"
        />
        <a href="/prompts/screenwriter.txt" download="通用编剧提示词.txt">下载通用编剧提示词</a>
      </details>
      <div className="wr-section-heading wr-length-heading">
        <h2>片名与篇幅</h2>
        <small>全剧目标 {Number(value.count) * Number(value.seconds) || 0} 秒</small>
      </div>
      <div className="wr-length">
        <label>
          剧本名称
          <input
            value={value.name}
            maxLength={100}
            placeholder="给这个故事起个名字"
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label>
          章节数
          <input
            type="number"
            min={1}
            max={60}
            required
            value={value.count}
            onChange={(e) => set("count", e.target.value === "" ? "" : Number(e.target.value))}
          />
        </label>
        <label>
          每章秒数
          <input
            type="number"
            min={5}
            max={300}
            required
            value={value.seconds}
            onChange={(e) => set("seconds", e.target.value === "" ? "" : Number(e.target.value))}
          />
        </label>
      </div>
    </>
  );
}
function useWriterModel() {
  const [settings, show] = useState(false),
    [reload, setReload] = useState(0);
  const { profiles, loadError } = useProfiles(reload);
  const [preferred, setPreferred] = useState(() => localStorage.getItem("studio-writing-model") || "");
  const profileId = profiles?.find((p) => p.id === preferred)?.id || profiles?.[0]?.id || "";
  const control = (
    <div className="wr-model">
      {profiles?.length > 0 && (
        <Select
          aria-label="编剧模型"
          value={profileId}
          onValueChange={(id) => {
            setPreferred(id);
            localStorage.setItem("studio-writing-model", id);
          }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
      <button type="button" className="quiet" onClick={() => show(true)}>
        <Settings2 size={14} />
        {profileId ? "模型设置" : "配置编剧模型"}
      </button>
      {loadError && <small role="alert">{loadError}</small>}
    </div>
  );
  const dialog = settings && (
    <PromptModelSettings
      close={() => {
        show(false);
        setReload((n) => n + 1);
      }}
    />
  );
  return { profileId, loading: profiles === null && !loadError, control, dialog };
}
function Shelf({ go }) {
  const [items, setItems] = useState(null),
    [form, setForm] = useState(defaults),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const model = useWriterModel(),
    briefInput = useRef(null),
    setup = useRef(null);
  useEffect(() => {
    api("/writing")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  async function create(e) {
    e.preventDefault();
    if (busy || model.loading) return;
    setBusy(true);
    setError("");
    let draft;
    try {
      draft = await api("/writing", "POST", {
        ...form,
        name: form.name.trim() || form.brief.trim().slice(0, 24),
      });
      if (model.profileId)
        await api("/writing/" + draft.id + "/generate", "POST", {
          revision: draft.revision,
          action: "ideas",
          profileId: model.profileId,
          note: form.brief,
        });
      go("writing/" + draft.id);
    } catch (e) {
      setError(e.message);
      if (draft) setItems((rows) => [{ ...draft, chapters: 0 }, ...(rows || [])]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wr-page wr-launch">
      {model.dialog}
      <div className="wr-shelf">
        <form className="wr-launch-form" onSubmit={create}>
          <section className="wr-hero" aria-labelledby="wr-headline">
            <div className="wr-hero-frame" aria-hidden="true">
              <img src="/stills/operator.jpg" alt="" fetchPriority="high" />
            </div>
            <div className="wr-hero-inner">
              <h1 id="wr-headline">剧本创作</h1>
              <div className="wr-idea-box">
                <div className="wr-idea-heading">
                  <label htmlFor="wr-brief">你想讲一个什么故事？</label>
                  <button
                    type="button"
                    className="wr-change-writer"
                    data-genre={form.style}
                    aria-label={"更换编剧，当前为" + writers[form.style].name}
                    onClick={() => setup.current?.querySelector('[aria-pressed="true"]')?.focus()}
                  >
                    {writers[form.style].name}
                    <ChevronDown size={13} />
                  </button>
                </div>
                <textarea
                  ref={briefInput}
                  id="wr-brief"
                  aria-label="故事创意"
                  rows={2}
                  required
                  maxLength={6000}
                  value={form.brief}
                  onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  placeholder="从一个人物、一句对白，或意外发生的那一刻写起…"
                />
                <div className="wr-actions">
                  {model.control}
                  <button
                    className="solid wr-send"
                    disabled={
                      busy ||
                      model.loading ||
                      !form.brief.trim() ||
                      (form.style === "custom" && !form.direction.trim())
                    }
                  >
                    {busy
                      ? "正在保存创意…"
                      : model.loading
                        ? "读取模型…"
                        : model.profileId
                          ? "发送创意，生成梗概"
                          : "保存创意草稿"}
                    {busy ? <LoaderCircle size={16} className="wr-spin" /> : <ArrowUpRight size={16} />}
                  </button>
                </div>
              </div>
              {error && (
                <p role="alert" className="wr-error">
                  {error}
                </p>
              )}
            </div>
          </section>
          <section ref={setup} className="wr-form wr-config">
            <Setup value={form} onChange={setForm} />
          </section>
        </form>
        <section className="wr-library">
          <div className="wr-section-heading">
            <h2>
              <LibraryBig size={18} />
              我的剧本
            </h2>
            {!!items?.length && <small>{items.length} 部</small>}
          </div>
          {!items ? (
            <p role="status">{error ? "剧本列表暂时无法读取" : "正在读取剧本…"}</p>
          ) : !items.length ? (
            <div className="wr-shelf-empty">
              <span className="wr-empty-cover" aria-hidden="true">
                <Feather size={26} strokeWidth={1.4} />
              </span>
              <strong>还没有剧本</strong>
              <p>写下第一个创意后，可以在这里继续上次的创作。</p>
              <button type="button" className="quiet" onClick={() => briefInput.current?.focus()}>
                写下创意
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            items.map((d) => (
              <button
                key={d.id}
                className="wr-book"
                data-genre={d.style}
                onClick={() => go("writing/" + d.id)}
              >
                <span className="wr-cover" aria-hidden="true">
                  <BookOpen size={17} />
                </span>
                <span className="wr-book-info">
                  <strong>{d.name}</strong>
                  <small>
                    {writers[d.style].name} · {d.chapters ? d.chapters + " 章" : "构思中"}
                  </small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
function EditDialog({ edit, save, close, assets, busy }) {
  const [value, setValue] = useState(edit.value),
    [error, setError] = useState("");
  const set = (key, v) => setValue({ ...value, [key]: v });
  async function submit(e) {
    e.preventDefault();
    try {
      await save(edit.action === "script" ? value.script : value);
      close();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Modal title={edit.label} close={close} wide>
      <form className="wr-form" onSubmit={submit}>
        {edit.action === "settings" ? (
          <Setup value={value} onChange={setValue} />
        ) : (
          <>
            {edit.action === "asset" && (
              <label>
                类别
                <Select value={value.type} onValueChange={(v) => set("type", v)}>
                  {Object.entries(referenceTypes).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {Object.entries(edit.fields).map(([key, label]) => (
              <label key={key}>
                {label}
                {["name", "title"].includes(key) ? (
                  <input
                    required
                    maxLength={limits[key]}
                    value={value[key]}
                    onChange={(e) => set(key, e.target.value)}
                  />
                ) : (
                  <textarea
                    rows={key === "script" || key === "premise" ? 12 : 3}
                    required={key !== "dialogue"}
                    value={value[key]}
                    maxLength={key === "summary" && edit.action === "idea" ? 4000 : limits[key]}
                    onChange={(e) => set(key, e.target.value)}
                  />
                )}
              </label>
            ))}
            {edit.action === "shot" && (
              <>
                <label>
                  时长（秒）
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={value.duration}
                    required
                    onChange={(e) => set("duration", Number(e.target.value))}
                  />
                </label>
                <label className="wr-cast-toggle">
                  <input
                    type="checkbox"
                    checked={!!value.emptyCast}
                    onChange={(e) => {
                      const emptyCast = e.target.checked;
                      const assetIds = emptyCast
                        ? assets.filter((a) => a.type !== "character" && value.assetIds.includes(a.id)).map((a) => a.id)
                        : value.assetIds;
                      setValue({ ...value, emptyCast, assetIds });
                    }}
                  />
                  空镜（无人出场）
                </label>
                <label>
                  引用资产
                  <Select multiple value={value.assetIds} onValueChange={(v) => set("assetIds", v)}>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id} disabled={value.emptyCast && a.type === "character"}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="wr-error">
            {error}
          </p>
        )}
        <div className="wr-buttons">
          <button type="button" className="outline" onClick={close}>
            取消
          </button>
          <button className="solid" disabled={busy}>
            保存修改
          </button>
        </div>
      </form>
    </Modal>
  );
}
function EditButton({ label, onClick, disabled }) {
  return (
    <button className="quiet" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      <Pencil size={14} />
    </button>
  );
}
const chapterFields = { title: "章节名", summary: "章节提要" };
function Manuscript({ draft, stage, idea, chapter, disabled, select, edit, chooseChapter, next, focusShot }) {
  const pen = (action, item, fields, label) => (
    <EditButton
      label={label}
      disabled={disabled}
      onClick={() => edit({ action, value: item, fields, label, id: item.id, chapterId: chapter?.id })}
    />
  );
  if (stage === "ideas") {
    if (!draft.ideas.length) return <Empty text="把故事创意发给编剧，这里会出现三版可编辑的梗概。" />;
    const currentCards = [],
      olderCards = [];
    draft.ideas.forEach((item, i) => {
      const cards = i >= draft.ideas.length - 3 || item.id === idea?.id ? currentCards : olderCards;
      cards.push(
        <article className={"wr-card" + (item.id === idea?.id ? " selected" : "")} key={item.id}>
          <header>
            <small>方案 {i + 1}</small>
            {pen("idea", item, conceptFields, "编辑梗概 " + (i + 1))}
          </header>
          <h3>{item.title}</h3>
          <blockquote>{item.hook}</blockquote>
          <p>{item.summary}</p>
          <details>
            <summary>看点与追看理由</summary>
            <p>{item.appeal}</p>
          </details>
          <button className="outline" disabled={disabled} onClick={() => select(item.id)}>
            {item.id === idea?.id ? <Check size={14} /> : <ArrowRight size={14} />}
            {item.id === idea?.id ? "已选用 · 查看章节" : "选用这个梗概"}
          </button>
        </article>,
      );
    });
    return (
      <>
        {currentCards}
        {olderCards.length > 0 && (
          <details className="wr-earlier-ideas">
            <summary>更早的方案（{olderCards.length}）</summary>
            <div>{olderCards}</div>
          </details>
        )}
      </>
    );
  }
  if (!idea) return <Empty text="先从故事梗概中选定一个方案。" />;
  if (stage === "outline")
    return idea.chapters.length ? (
      idea.chapters.map((c, i) => (
        <article className="wr-card" key={c.id}>
          <header>
            <small>
              第 {i + 1} 章 · {c.seconds} 秒
            </small>
            <EditButton
              label={"编辑第 " + (i + 1) + " 章大纲"}
              disabled={disabled}
              onClick={() =>
                edit({
                  action: "chapter",
                  label: "编辑章节大纲",
                  fields: chapterFields,
                  value: c,
                  chapterId: c.id,
                })
              }
            />
          </header>
          <h3>{c.title}</h3>
          <p>{c.summary}</p>
          <button
            className="outline"
            onClick={() => {
              chooseChapter(c.id);
              next("script");
            }}
          >
            <FileText size={14} />
            {c.script ? "查看本章剧本" : "去扩写本章"}
          </button>
        </article>
      ))
    ) : (
      <Empty text={"已选《" + idea.title + "》。按当前篇幅生成章节大纲后，可以逐章扩写。"} />
    );
  if (!chapter) return <Empty text="生成章节大纲后，在这里选择要制作的章节。" />;
  if (stage === "script")
    return chapter.script ? (
      <article className="wr-card">
        <header>
          <h3>{chapter.title}</h3>
          {pen("script", { script: chapter.script }, { script: "章节正文" }, "编辑章节剧本")}
        </header>
        <p className="wr-script">{chapter.script}</p>
        {!!chapter.earlierScripts?.length && (
          <details className="wr-script-history" key={chapter.id}>
            <summary>查看旧稿（{chapter.earlierScripts.length}）</summary>
            {chapter.earlierScripts.map((script, i) => (
              <button
                key={i}
                className="quiet"
                disabled={disabled}
                onClick={() => edit({
                  action: "script",
                  value: { script },
                  fields: { script: "章节正文" },
                  label: "查看第 " + (i + 1) + " 稿 · 保存后采用",
                  chapterId: chapter.id,
                })}
              >
                <FileText size={14} />第 {i + 1} 稿
              </button>
            )).reverse()}
          </details>
        )}
      </article>
    ) : (
      <Empty text={chapter.summary} />
    );
  if (stage === "assets")
    return chapter.assets.length ? (
      chapter.assets.map((a) => (
        <article key={a.id} className="wr-card">
          <header>
            <small>{referenceTypes[a.type]}</small>
            {pen("asset", a, assetFields, "编辑资产 " + a.name)}
          </header>
          <h3>{a.name}</h3>
          <p>{a.description}</p>
          <details>
            <summary>资产绘图提示词</summary>
            <p>{a.prompt}</p>
          </details>
        </article>
      ))
    ) : (
      <Empty text="根据本章剧本提取出场人物、场景和关键道具，编写统一的视觉设定与绘图提示词。" />
    );
  let time = 0;
  return chapter.shots.length ? (
    chapter.shots.map((s, i) => {
      const start = time;
      time += s.duration;
      return (
        <article key={s.id} className="wr-card">
          <header>
            <small>
              镜 {i + 1} · {start}–{time} 秒 · {s.framing}
            </small>
            {pen("shot", s, takeFields, "编辑镜头 " + (i + 1))}
          </header>
          <h3>{s.title}</h3>
          <p>{s.visual}</p>
          <dl>
            <dt>运镜</dt>
            <dd>{s.camera}</dd>
            {s.dialogue && (
              <>
                <dt>对白／声音</dt>
                <dd>{s.dialogue}</dd>
              </>
            )}
          </dl>
          {!!s.assetIds.length && (
            <small>
              {s.assetIds
                .map((id) => chapter.assets.find((a) => a.id === id)?.name)
                .filter(Boolean)
                .join(" · ")}
            </small>
          )}
          <details>
            <summary>制作提示词</summary>
            <dl>
              <dt>绘图</dt>
              <dd>{s.imagePrompt}</dd>
              <dt>视频</dt>
              <dd>{s.videoPrompt}</dd>
            </dl>
          </details>
          <button className="quiet" disabled={disabled} onClick={() => focusShot(s.id)}>
            <MessageCircle size={14} />
            跟编剧改这镜
          </button>
        </article>
      );
    })
  ) : (
    <Empty text="按本章时长拆镜，每镜包含画面、声音、运镜、引用资产和制作提示词。" />
  );
}
function Empty({ text }) {
  return (
    <div className="wr-empty">
      <FileText size={25} />
      <p>{text}</p>
    </div>
  );
}
function Workbench({ id, go }) {
  const [draft, setDraft] = useState(null),
    [stage, setStage] = useState(() => {
      const saved = sessionStorage.getItem("writing-stage-" + id);
      return writingStages.some(([key]) => key === saved) ? saved : "ideas";
    }),
    [chapterId, chooseChapter] = useState(() => sessionStorage.getItem("writing-chapter-" + id) || ""),
    [shotId, setShot] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [editing, edit] = useState(null),
    [importing, setImporting] = useState(false);
  const path = "/writing/" + id,
    model = useWriterModel(),
    chat = useRef(null),
    composer = useRef(null);
  useEffect(() => {
    sessionStorage.setItem("writing-stage-" + id, stage);
    sessionStorage.setItem("writing-chapter-" + id, chapterId);
  }, [id, stage, chapterId]);
  const pending = draft?.task?.id;
  useEffect(() => {
    let live = true,
      timer;
    async function load() {
      try {
        const value = await api(path);
        if (live) {
          setDraft(value);
          setError("");
        }
      } catch (e) {
        if (live) setError(e.message);
      }
      if (live && pending) timer = setTimeout(load, 1200);
    }
    if (!draft || pending) load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, pending]);
  useEffect(() => {
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [draft?.messages.length, pending]);
  const idea = draft && activeConcept(draft),
    chapter = idea?.chapters.find((c) => c.id === chapterId) || idea?.chapters[0];
  const target = stage === "shots" && chapter?.shots.find((s) => s.id === shotId);
  function next(value) {
    setStage(value);
    setShot("");
  }
  async function request(suffix, method, payload) {
    setBusy(true);
    setError("");
    try {
      const value = await api(path + suffix, method, { ...payload, revision: draft.revision });
      setDraft(value.draft || value);
      return value;
    } catch (e) {
      setError(e.message);
      if (e.status === 409)
        await api(path)
          .then(setDraft)
          .catch(() => {});
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function generate(action) {
    try {
      await request("/generate", "POST", {
        action,
        profileId: model.profileId,
        note: note.trim(),
        chapterId: ["script", "assets", "shots"].includes(stage) ? chapter?.id : undefined,
        shotId: target?.id,
      });
      setNote("");
      setShot("");
    } catch {}
  }
  if (!draft)
    return (
      <div className="wr-page">
        <button className="quiet" onClick={() => go("writing")}>
          <ArrowLeft size={15} />
          我的剧本
        </button>
        <p role="status">{error || "正在读取剧本…"}</p>
      </div>
    );
  const memory = storyMemory(draft);
  const locked = busy || !!pending;
  const action = target ? "shot" : stage === "ideas" && idea && note.trim() ? "concept" : stage;
  const ready =
    !!model.profileId &&
    !locked &&
    (stage === "ideas" ||
      (idea &&
        (stage === "outline" ||
          (chapter &&
            (stage === "script" || (chapter.script && (stage === "assets" || chapter.assets.length)))))));
  const label =
    {
      ideas: draft.ideas.length > 0 && "按当前设定再写三版",
      outline: idea?.chapters.length && "另起一版大纲",
      script: chapter?.script && "重写本章剧本",
      assets: chapter?.assets.length && "更新本章资产",
      shots: chapter?.shots.length && "重写本章分镜",
    }[action] || writingActions[action];
  async function select(id) {
    try {
      if (id !== idea?.id) await request("", "PATCH", { action: "select", id });
      chooseChapter("");
      next("outline");
    } catch {}
  }
  async function importChapter() {
    setImporting(true);
    try {
      const { projectId } = await request("/import", "POST", { chapterId: chapter.id });
      go("project/" + projectId);
    } catch {
      setImporting(false);
    }
  }
  return (
    <div className="wr-page wr-workspace" data-genre={draft.style}>
      {model.dialog}
      <div className="wr-breadcrumb">
        <button className="quiet" onClick={() => go("writing")}>
          <ArrowLeft size={14} />
          我的剧本
        </button>
      </div>
      <div className="wr-title">
        <div>
          <h1>{draft.name}</h1>
          <p className="wr-subtitle">
            {writers[draft.style].name} · {draft.count} 章 · 每章 {draft.seconds} 秒
          </p>
        </div>
        <button
          className="outline"
          disabled={locked}
          onClick={() =>
            edit({
              action: "settings",
              label: "创作设置",
              value: {
                name: draft.name,
                style: draft.style,
                direction: draft.direction,
                count: draft.count,
                seconds: draft.seconds,
              },
            })
          }
        >
          <Settings2 size={14} />
          创作设置
        </button>
      </div>
      <div className="wr-desk">
        <aside className="wr-panel wr-chat">
          <h2>
            <Feather size={17} />
            {writers[draft.style].name}编剧
          </h2>
          <details className="wr-memory">
            <summary>
              故事设定{memory.additions.length > 0 && <small> · {memory.additions.length} 条作者补充</small>}
            </summary>
            <div className="wr-memory-body">
              <p>{memory.premise}</p>
              {!!memory.additions.length && (
                <ol>
                  {memory.additions.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ol>
              )}
              <button
                className="quiet"
                disabled={locked}
                onClick={() =>
                  edit({
                    action: "memory",
                    label: "整理故事设定",
                    fields: { premise: "后续创作采用的设定" },
                    value: {
                      premise: [memory.premise, ...memory.additions].join("\n\n"),
                      through: draft.messages.length,
                    },
                  })
                }
              >
                <Pencil size={13} />
                整理设定
              </button>
            </div>
          </details>
          <div ref={chat} className="wr-messages" role="log" aria-label="编剧对话">
            <div className="wr-message author">
              <small>最初创意</small>
              <p>{draft.brief}</p>
            </div>
            {draft.messages
              .filter((m, i) => !(i === 0 && m.text === draft.brief))
              .map((m, i) => (
                <div key={i} className={"wr-message " + (m.role === "user" ? "author" : "")}>
                  <small>{m.role === "user" ? "你" : "编剧"}</small>
                  <p>{m.text}</p>
                </div>
              ))}
            {pending && (
              <small className="wr-working">
                <LoaderCircle size={14} className="wr-spin" />
                {writingActions[draft.task.action]}中…
              </small>
            )}
          </div>
          <div className="wr-compose">
            {target && (
              <button className="outline" onClick={() => setShot("")}>
                {target.title}
                <X size={12} />
              </button>
            )}
            <label htmlFor="wr-note">{target ? "单镜修改要求" : "和编剧聊聊"}</label>
            <textarea
              id="wr-note"
              ref={composer}
              rows={4}
              maxLength={6000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="说说故事想法，或告诉编剧这一步想怎么改…"
            />
            <div className="wr-buttons">
              <button
                className="outline"
                disabled={locked || !note.trim() || !model.profileId}
                onClick={() => generate("chat")}
              >
                <MessageCircle size={14} />
                只讨论
              </button>
              <button
                className="solid"
                disabled={!ready || (target && !note.trim())}
                onClick={() => generate(action)}
              >
                <Send size={14} />
                {label}
              </button>
            </div>
            {action === "concept" && (
              <button className="quiet" disabled={!ready} onClick={() => generate("ideas")}>
                按新要求再给三版
              </button>
            )}
            {model.control}
            {(error || draft.error) && (
              <p role="alert" className="wr-error">
                {error || draft.error}
              </p>
            )}
          </div>
        </aside>
        <section className="wr-panel wr-paper">
          <nav
            aria-label="编剧创作步骤"
            className="wr-tabs"
            style={{
              "--step": writingStages.findIndex(([key]) => key === stage),
              "--steps": writingStages.length,
            }}
          >
            {writingStages.map(([key, l]) => (
              <button key={key} aria-current={key === stage ? "step" : undefined} onClick={() => next(key)}>
                {l}
              </button>
            ))}
          </nav>
          <div className="wr-sheet-head">
            <h2>{writingStages.find((s) => s[0] === stage)[1]}</h2>
            {["script", "assets", "shots"].includes(stage) && idea?.chapters.length > 0 ? (
              <Select
                aria-label="当前章节"
                value={chapter.id}
                onValueChange={(v) => {
                  chooseChapter(v);
                  setShot("");
                }}
              >
                {idea.chapters.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    第 {i + 1} 章 · {c.title}
                  </option>
                ))}
              </Select>
            ) : (
              <small>
                {stage === "ideas"
                  ? draft.ideas.length + " 个方案"
                  : draft.count + " 章 × " + draft.seconds + " 秒"}
              </small>
            )}
          </div>
          {chapter?.review.includes(stage) && (
            <div className="wr-review">
              上一步有修改，请复核本页内容。
              <button
                className="outline"
                disabled={locked}
                onClick={() =>
                  request("", "PATCH", { action: "review", chapterId: chapter.id, value: stage }).catch(
                    () => {},
                  )
                }
              >
                已复核
              </button>
            </div>
          )}
          <div className="wr-pages" key={stage + (chapter?.id || "")} data-stage={stage}>
            {pending &&
              (draft.task.action === stage ||
                (stage === "shots" && draft.task.action === "shot") ||
                (stage === "ideas" && draft.task.action === "concept")) && (
                <div className="wr-drafting" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            <Manuscript
              {...{ draft, stage, idea, chapter, select, edit, chooseChapter, next }}
              disabled={locked}
              focusShot={(id) => {
                setShot(id);
                composer.current?.focus();
              }}
            />
          </div>
          <footer className="wr-paper-footer">
            {stage === "shots" && chapter?.shots.length ? (
              <>
                <small>
                  {chapter.shots.length} 镜 · {chapter.shots.reduce((t, s) => t + s.duration, 0)} /{" "}
                  {chapter.seconds} 秒
                </small>
                {chapter.projectId && (
                  <button className="quiet" onClick={() => go("project/" + chapter.projectId)}>
                    上次画布
                  </button>
                )}
                <button
                  className="solid"
                  disabled={locked || !!chapter.review.length}
                  title={chapter.review.length ? "请先复核前序内容" : ""}
                  onClick={importChapter}
                >
                  {importing ? <LoaderCircle size={15} className="wr-spin" /> : <Clapperboard size={15} />}
                  {importing ? "正在导入画布…" : "导入本章到画布"}
                </button>
              </>
            ) : (
              stage !== "shots" && (
                <button
                  className="outline"
                  disabled={
                    !(stage === "ideas"
                      ? idea
                      : stage === "outline"
                        ? idea?.chapters.length
                        : stage === "script"
                          ? chapter?.script
                          : chapter?.assets.length)
                  }
                  onClick={() => next(writingStages[writingStages.findIndex((s) => s[0] === stage) + 1][0])}
                >
                  {
                    {
                      ideas: "查看章节大纲",
                      outline: "进入章节剧本",
                      script: "进入资产设定",
                      assets: "进入分镜表",
                    }[stage]
                  }
                  <ArrowRight size={14} />
                </button>
              )
            )}
          </footer>
        </section>
      </div>
      {editing && (
        <EditDialog
          edit={editing}
          busy={busy}
          assets={chapter?.assets || []}
          close={() => edit(null)}
          save={(value) =>
            request("", "PATCH", {
              action: editing.action,
              value,
              id: editing.id,
              chapterId: editing.chapterId,
            })
          }
        />
      )}
    </div>
  );
}
export function WritingRoom({ id, go }) {
  return id ? <Workbench id={id} go={go} /> : <Shelf go={go} />;
}
