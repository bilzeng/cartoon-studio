import { PromptModelSettings } from "./PromptOptimizer";
import { EnvironmentSettings } from "./EnvironmentSettings";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Boxes,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Film,
  Folder,
  FolderOpen,
  Home,
  Menu,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { defaultSeries } from "../shared/series";
import { SeriesFields, ScriptField } from "./series";
import { kinds, makeNode, samples } from "../shared/studio";
import { api } from "./client";
import { Guide, Mark, Media, Modal, SampleCard, icons } from "./ui";
import { Library, Jobs } from "./library";
import { Editor } from "./editor";
import { WritingRoom } from "./WritingRoom";
import { StudioUpdate } from "./StudioUpdate";

function CanvasLaunch({ onClick }) {
  function followPointer(event) {
    if (event.pointerType === "touch") return;
    const { style } = event.currentTarget;
    style.setProperty("--spot-x", event.nativeEvent.offsetX + "px");
    style.setProperty("--spot-y", event.nativeEvent.offsetY + "px");
  }
  return (
    <button type="button" className="launch" onPointerMove={followPointer} onClick={onClick}>
      <span className="launch-dots" aria-hidden="true"><span className="launch-spot" /></span>
      <span className="launch-plus" aria-hidden="true"><Plus size={26} strokeWidth={2.4} /></span>
      <span className="launch-label">新建画布创作</span>
    </button>
  );
}

export function App() {
  const [series, setSeries] = useState(defaultSeries),
    [script, setScript] = useState("");
  const importInput = useRef(null);
  const [route, setRoute] = useState(location.hash.slice(1) || "home");
  const [projects, setProjects] = useState([]),
    [assets, setAssets] = useState([]),
    [jobs, setJobs] = useState([]);
  const [dialog, setDialog] = useState(""),
    [menu, setMenu] = useState(false),
    [toast, setToast] = useState(""),
    [search, setSearch] = useState("");
  const [name, setName] = useState(""),
    [template, setTemplate] = useState(""),
    [entry, setEntry] = useState(""),
    [busy, setBusy] = useState(false),
    [catalog, setCatalog] = useState("全部");
  const notify = useCallback((msg) => setToast(msg), []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4800);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const refresh = useCallback(async () => {
    const result = await Promise.all([
      api("/projects"),
      api("/assets"),
      api("/jobs"),
    ]);
    setProjects(result[0]);
    setAssets(result[1]);
    setJobs(result[2]);
  }, []);
  useEffect(() => {
    refresh().catch((e) => notify(e.message));
  }, [refresh, route, notify]);
  useEffect(() => {
    if (route !== "jobs" && !dialog.startsWith("jobs")) return;
    const t = setInterval(
      () => refresh().catch((e) => notify(e.message)),
      1800,
    );
    return () => clearInterval(t);
  }, [route, dialog, refresh, notify]);
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1) || "home");
      window.scrollTo({ top: 0, behavior: "instant" });
      setMenu(false);
      setSearch("");
      setDialog("");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const nav = document.getElementById("studio-navigation");
    (nav.querySelector("[aria-current='page']") || nav.querySelector("nav button"))?.focus();
    const mobile = window.matchMedia("(max-width: 640px)");
    const resized = () => { if (!mobile.matches) setMenu(false); };
    mobile.addEventListener("change", resized);
    return () => mobile.removeEventListener("change", resized);
  }, [menu]);
  function closeNav() {
    setMenu(false);
    document.querySelector(".mobile-bar button")?.focus();
  }
  function go(value) {
    location.hash = value;
    setMenu(false);
  }
  function openFromNav(dialogName) {
    if (menu) closeNav();
    setDialog(dialogName);
  }
  function createForm(key = "", kind = "") {
    setTemplate(key);
    setSeries(defaultSeries);
    setScript("");
    setName(samples.find((s) => s.key === key)?.name || "");
    setEntry(kind);
    openFromNav("new");
  }
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const freeCanvas = !template && !script.trim();
      const first =
        freeCanvas && entry
          ? makeNode(entry, { x: 0, y: 0 }, { title: kinds[entry] + "节点 1" })
          : null;
      const b = await api("/projects", "POST", {
        ...(freeCanvas && {
          board: {
            name: name.trim(),
            series,
            nodes: first ? [first] : [],
            edges: [],
            order: first?.data.kind === "shot" ? [first.id] : [],
          },
        }),
        template,
        name: name.trim(),
        series,
        script,
      });
      go(
        "project/" +
          b.id +
          (first
            ? "?node=" + first.id
            : entry && !freeCanvas
              ? "?add=" + entry
              : ""),
      );
      setDialog("");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const nav = (id, Icon, label) => (
    <button
      key={id}
      className={route.split("/")[0] === id ? "chosen" : ""}
      aria-current={route.split("/")[0] === id ? "page" : undefined}
      onClick={() => go(id)}
    >
      <Icon size={17} />
      {label}
    </button>
  );
  async function importBoard(file) {
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw Error("画布文件过大");
      const board = JSON.parse(await file.text());
      const b = await api("/projects", "POST", { board });
      go("project/" + b.id);
    } catch (e) {
      notify(e instanceof SyntaxError ? "请选择有效的画布 JSON" : e.message);
    } finally {
      importInput.current.value = "";
    }
  }
  function recent(list) {
    return (
      <div className="project-grid">
        {list.map((p) => {
          const asset = assets.find((a) => a.id === p.coverId);
          return (
            <button
              key={p.id}
              className="project-card"
              onClick={() => go("project/" + p.id)}
            >
              <div className="project-icon">
                {asset ? <Media asset={asset} /> : <FolderOpen />}
              </div>
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.count} 个分镜 ·{" "}
                  {new Date(p.updated).toLocaleDateString("zh-CN")}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          );
        })}
      </div>
    );
  }
  const editor = route.startsWith("project/");
  return (
    <>
      {editor ? (
        <Editor
          key={route}
          route={route}
          assets={assets}
          refresh={refresh}
          notify={notify}
          home={() => go("home")}
        />
      ) : (
        <div className="shell">
          <div className="mobile-bar">
            <button
              className="ico"
              aria-label="打开导航"
              aria-controls="studio-navigation"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <Mark />
          </div>
          {menu && (
            <button
              className="scrim"
              aria-label="关闭导航"
              onClick={closeNav}
            ></button>
          )}
          <aside id="studio-navigation" className={"side " + (menu ? "open" : "")}
            onKeyDown={e => {
              if (!menu) return;
              if (e.key === "Escape") closeNav();
              if (e.key !== "Tab") return;
              const buttons = e.currentTarget.querySelectorAll("button:enabled");
              const first = buttons[0], last = buttons[buttons.length - 1];
              if ((!e.shiftKey && e.target === last) || (e.shiftKey && e.target === first)) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
              }
            }}>
            <Mark />
            <nav>
              {nav("home", Home, "首页")}
              {nav("projects", Folder, "项目")}
              {nav("assets", Boxes, "资产")}
            </nav>
            <label>创作</label>
            <nav>
              <button onClick={() => createForm()}>
                <Clapperboard size={17} />
                创作画布
              </button>
              {nav("writing", icons.script, "剧本创作")}
              {nav("jobs", Activity, "任务记录")}
              <button onClick={() => openFromNav("environment")}>
                <Activity size={17} />
                ComfyUI 环境
              </button>
              <button onClick={() => openFromNav("promptModels")}><SlidersHorizontal size={17} />提示词模型</button>
            </nav>
            <label>学习</label>
            <nav>
              {nav("samples", Film, "示例画布")}
              <button
                onClick={() => openFromNav("guide")}
              >
                <BookOpen size={17} />
                使用指南
              </button>
            </nav>
            <StudioUpdate notify={notify} />
            <button
              className="workspace"
              onClick={() => openFromNav("workspace")}
            >
              <span className="avatar">镜</span>
              <span>
                <strong>个人工作区</strong>
                <small>本机存储</small>
              </span>
              <ChevronRight size={14} />
            </button>
          </aside>
          <main key={route} data-page={route.split("/")[0]}
            className={route.startsWith("writing/") ? "dashboard writing-dashboard" : "dashboard"}>
            <header className="dash-head">
              {route.startsWith("writing/") ? (
                <button className="quiet" onClick={() => go("writing")}>
                  <ArrowLeft size={15} /> 我的剧本
                </button>
              ) : <span>
                <span className="tiny-dot" />
                个人工作区
              </span>}
              <button className="quiet" onClick={() => setDialog("guide")}>
                <CircleHelp size={16} />
                创作指南
              </button>
            </header>
            {route === "home" && (
              <>
                <CanvasLaunch onClick={() => createForm()} />
                <div className="section-title compact">
                  <h2>创作工具</h2>
                </div>
                <div className="shortcuts">
                  <button className="outline" onClick={() => go("writing")}><BookOpen size={16} />剧本创作</button>
                  {[
                    ["script", "剧本拆镜"],
                    ["image", "图片创作"],
                    ["video", "视频素材"],
                    ["audio", "音频素材"],
                    ["shot", "分镜编排"],
                  ].map(([kind, label]) => {
                    const Icon = icons[kind];
                    return (
                      <button className="outline" onClick={() => createForm("", kind)} key={kind}>
                        <Icon size={16} />
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="home-library">
                  <section>
                    <div className="section-title">
                      <h2>最近项目</h2>
                      <button onClick={() => go("projects")}>
                        全部项目 <ArrowRight size={14} />
                      </button>
                    </div>
                    {projects.length ? (
                      recent(projects.slice(0, 6))
                    ) : (
                      <button
                        className="empty-box"
                        onClick={() => createForm("tide")}
                      >
                        <Clapperboard />
                        <span>
                          <strong>从一个完整分镜开始</strong>
                          <small>打开《潮汐电台》，试着替换第一个镜头。</small>
                        </span>
                        <ArrowRight size={18} />
                      </button>
                    )}
                  </section>
                  <section>
                    <div className="section-title">
                      <h2>示例画布</h2>
                      <button onClick={() => go("samples")}>
                        查看全部 <ArrowRight size={14} />
                      </button>
                    </div>
                    <div className="samples">
                      {samples.map((item) => (
                        <SampleCard
                          key={item.key}
                          item={item}
                          onClick={() => createForm(item.key)}
                        />
                      ))}
                    </div>
                  </section>
                </div>
              </>
            )}
            {route.split("/")[0] === "writing" && <WritingRoom key={route} id={route.split("/")[1]} go={go} />}
            {route === "projects" && (
              <>
                <div className="page-title">
                  <h1>全部项目</h1>
                  <button className="outline" onClick={() => importInput.current.click()}>
                    导入画布 JSON
                  </button>
                  <input
                    ref={importInput}
                    hidden
                    type="file"
                    accept=".json"
                    onChange={(e) => importBoard(e.target.files[0])}
                  />
                  <button className="solid" onClick={() => createForm()}>
                    <Plus size={16} />
                    新建画布
                  </button>
                </div>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="搜索项目"
                    placeholder="搜索项目"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {recent(filtered)}
                {!filtered.length && (
                  <p className="empty">
                    {search
                      ? "没有找到这个项目"
                      : "创建一张画布，项目会保存在这里。"}
                  </p>
                )}
              </>
            )}
            {route === "assets" && (
              <>
                <h1>素材资产</h1>
                <Library assets={assets} projects={projects} refresh={refresh} notify={notify} />
              </>
            )}
            {route === "jobs" && (
              <>
                <h1>任务记录</h1>
                <Jobs rows={jobs} assets={assets} refresh={refresh} notify={notify} />
              </>
            )}
            {route === "samples" && (
              <>
                <h1>示例画布</h1>
                <div className="filters">
                  {["全部", ...samples.map((i) => i.subtitle)].map((o) => (
                    <button
                      key={o}
                      className={o === catalog ? "active" : ""}
                      aria-pressed={o === catalog}
                      onClick={() => setCatalog(o)}
                    >
                      {o}
                    </button>
                  ))}
                </div>
                <div className="samples">
                  {samples
                    .filter((o) => catalog === "全部" || o.subtitle === catalog)
                    .map((item) => (
                      <SampleCard
                        key={item.key}
                        item={item}
                        onClick={() => createForm(item.key)}
                      />
                    ))}
                </div>
              </>
            )}
          </main>
        </div>
      )}
      {dialog === "new" && (
        <Modal
          title={template ? "使用示例画布" : "新建画布"}
          close={() => setDialog("")}
        >
          <form onSubmit={create} className="form project-create">
            {template && (
              <img
                className="form-cover"
                src={
                  "/stills/" +
                  samples.find((i) => i.key === template).cover +
                  ".jpg"
                }
                alt="示例画面"
              />
            )}
            <label>
              项目名称
              <input
                autoFocus
                maxLength={100}
                placeholder="给这部作品起个名字"
                value={name}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {!template && (
              <>
                <ScriptField value={script} onChange={setScript} />
                <details className="series-disclosure">
                  <summary>剧集设定 · {series.ratio}</summary>
                  <div className="form">
                    <SeriesFields
                      value={series}
                      onChange={setSeries}
                      assets={assets}
                    />
                  </div>
                </details>
              </>
            )}
            <button className="solid" disabled={busy || !name.trim()}>
              {busy ? "创建中…" : "创建并打开画布"}
              <ArrowRight size={15} />
            </button>
          </form>
        </Modal>
      )}
      {dialog === "guide" && (
        <Modal title="创作指南" close={() => setDialog("")}>
          <Guide />
        </Modal>
      )}
      {dialog === "promptModels" && <PromptModelSettings close={() => setDialog("")} />}
      {dialog === "environment" && (
        <EnvironmentSettings close={() => setDialog("")} notify={notify} />
      )}
      {dialog === "workspace" && (
        <Modal title="个人工作区" close={() => setDialog("")}>
          <p>
            画布、素材和导出的影片都保存在助手目录下的 data 文件夹。当前共有{" "}
            {projects.length} 个项目。
          </p>
        </Modal>
      )}
      {toast && (
        <div role="status" className="toast">
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={13} />
          </button>
        </div>
      )}
    </>
  );
}
