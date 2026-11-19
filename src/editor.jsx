import { Select } from "./Select";
import { removeCanvasNodes } from "../shared/canvasGroups";
import { EnvironmentSettings } from "./EnvironmentSettings";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileJson,
  Film,
  FolderOpen,
  Layers,
  ListVideo,
  Network,
  Pencil,
  Play,
  Plus,
  Scissors,
  Trash2,
  ImagePlus,
  X,
} from "lucide-react";
import { defaultSeries, seriesPrompt, ratios } from "../shared/series";
import { Inventory, SeriesFields, ScriptField } from "./series";
import { api, downloadJson } from "./client";
import {
  currentShots,
  frameAsset,
  kinds,
  makeId,
  makeNode,
  scriptShots,
} from "../shared/studio";
import { Guide, Media, Modal, icons } from "./ui";
import { Jobs, Library } from "./library";
import {
  ShotTable,
  ReferenceManager,
  ReferencePicker,
  TakeHistory,
} from "./storyboard";
import {
  referencesForShot,
  adoptTake,
  shotPrompt,
  referenceTypes,
} from "../shared/storyboard";
import { FlowCanvas } from "./FlowCanvas";
import { useBoard, useCanvasResults } from "./useBoard";
export function Editor(props) {
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  );
}
function Workspace({ route, assets, refresh, notify, home }) {
  const [path, query] = route.split("?"),
    id = path.slice(8),
    kind = new URLSearchParams(query).get("add");
  const { board, edit, flush, status, error } = useBoard(id, kind, notify);
  useCanvasResults(board, edit, refresh);
  const [engineType, setEngineType] = useState("image"),
    [reference, setReference] = useState("");
  const [draftSeries, setDraftSeries] = useState(defaultSeries),
    [nextName, setNextName] = useState(""),
    [nextScript, setNextScript] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [selected, select] = useState(
      new URLSearchParams(query).get("node") || "",
    ),
    [mode, setMode] = useState(
      new URLSearchParams(query).get("view") === "sheet" ? "sheet" : "canvas",
    ),
    [modal, setModal] = useState(""),
    [jobs, setJobs] = useState([]),
    [engine, setEngine] = useState(null),
    [checkpoint, setCheckpoint] = useState(""),
    [working, setWorking] = useState(false),
    [audio, setAudio] = useState(""),
    [rename, setRename] = useState(""),
    [preview, setPreview] = useState(0),
    [playing, setPlaying] = useState(false);
  const area = useRef(null),
    { screenToFlowPosition, fitView } = useReactFlow();
  const node = board?.nodes.find((n) => n.id === selected),
    seq = useMemo(() => (board ? currentShots(board) : []), [board]);
  const safe =
    (fn) =>
    async (...args) => {
      try {
        await fn(...args);
      } catch (e) {
        notify(e.message);
      }
    };
  const updateNode = (nid, props) =>
    edit((b) => ({
      ...b,
      nodes: b.nodes.map((n) =>
        n.id === nid ? { ...n, data: { ...n.data, ...props } } : n,
      ),
    }));
  const refreshJobs = useCallback(async () => {
    const rows = await api("/jobs?project=" + id);
    setJobs(rows);
    await refresh();
  }, [id, refresh]);
  useEffect(() => {
    if (modal !== "jobs") return;
    let live = true;
    const pull = () => live && refreshJobs().catch((e) => notify(e.message));
    pull();
    const t = setInterval(pull, 1700);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [modal, refreshJobs, notify]);
  useEffect(() => {
    if (modal !== "engine") return;
    let live = true;
    setEngine(null);
    api("/engine")
      .then((s) => {
        if (live) {
          setEngine(s);
          setCheckpoint(s.imageModels?.[0]?.id || "");
        }
      })
      .catch((e) => live && notify(e.message));
    return () => {
      live = false;
    };
  }, [modal, notify]);
  useEffect(() => {
    if (modal !== "preview" || !playing || !seq[preview]) return;
    const t = setTimeout(() => {
      if (preview + 1 >= seq.length) {
        setPlaying(false);
        return;
      }
      setPreview(preview + 1);
    }, seq[preview].data.duration * 1000);
    return () => clearTimeout(t);
  }, [modal, playing, preview, seq]);
  useEffect(() => setDialogError(""), [modal]);
  function add(type, asset) {
    if (board.nodes.length >= 250) {
      notify("每张画布最多 250 个节点");
      return;
    }
    const r = mode === "canvas" && area.current?.getBoundingClientRect();
    const pos = r
      ? screenToFlowPosition({
          x: r.left + r.width * 0.42,
          y: r.top + r.height * 0.36,
        })
      : {
          x: 335 + 300 * Math.floor(board.order.length / 2),
          y: (board.order.length % 2) * 258,
        };
    const n = makeNode(
      type,
      pos,
      asset
        ? { title: asset.name, assetId: asset.id }
        : type === "shot"
          ? { title: "镜头 " + (board.order.length + 1) }
          : {},
    );
    edit((b) => ({
      ...b,
      nodes: [...b.nodes, n],
      order: type === "shot" ? [...b.order, n.id] : b.order,
    }));
    select(n.id);
    setModal("");
    if (mode !== "sheet" || type !== "shot") setMode("canvas");
  }
  function split() {
    const x = Math.max(...board.nodes.map((n) => n.position.x)) + 310;
    const fresh = scriptShots(node, board.order.length, x);
    if (!fresh.length) {
      notify("请先写下剧本，每行一个镜头");
      return;
    }
    if (fresh.length + board.nodes.length > 250) {
      notify("每张画布最多 250 个节点，请分段拆镜");
      return;
    }
    edit((b) => ({
      ...b,
      nodes: [...b.nodes, ...fresh],
      edges: [
        ...b.edges,
        ...fresh.map((n) => ({ id: makeId(), source: node.id, target: n.id })),
      ],
      order: [...b.order, ...fresh.map((n) => n.id)],
    }));
    select(fresh[0].id);
    notify("已添加 " + fresh.length + " 个分镜");
    requestAnimationFrame(() => fitView({ duration: 250, padding: 36 }));
  }
  function removeNode() {
    edit((b) => removeCanvasNodes(b, [selected]));
    select("");
    setModal("");
  }
  function move(nid, offset) {
    edit((b) => {
      const order = [...b.order],
        i = order.indexOf(nid),
        j = i + offset;
      if (j < 0 || j >= order.length) return b;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...b, order };
    });
  }
  async function submit(task) {
    setWorking(true);
    try {
      const revision = await flush();
      const data =
        task === "export"
          ? { revision, audioId: audio }
          : {
              kind: engineType,
              shotId: node.data.kind === "shot" ? node.id : undefined,
              revision,
              duration: node.data.duration,
              shotCast: node.data.shotCast || "",
              assetId: canReference ? reference : "",
              environment: engine?.environment,
              checkpoint,
              prompt: node.data.text,
            };
      await api("/projects/" + id + "/" + task, "POST", data);
      setModal(
        task === "generate" && node?.data.kind === "shot" ? "takes" : "jobs",
      );
    } catch (e) {
      setDialogError(e.message);
      notify(e.message);
    } finally {
      setWorking(false);
    }
  }
  function openEngine(target, kind) {
    select(target.id);
    setEngineType(kind);
    const firstRef = referencesForShot(board, target.data).find(
      (card) => card.imageId,
    );
    const current = frameAsset(target, board, assets);
    setReference(
      (kind === "video" && current?.kind === "image"
        ? current.id
        : firstRef?.imageId) ||
        board.series?.refAssetId ||
        "",
    );
    setModal("engine");
  }
  async function useTake(take) {
    edit((b) => adoptTake(b, take));
    await flush();
    notify("已采用此版，仅更新原分镜");
  }
  function pickAsset(asset) {
    if (node) updateNode(node.id, { assetId: asset.id });
    else add(asset.kind, asset);
    setModal("");
  }
  function addLibraryAssets(picked) {
    if (!picked.length) return;
    const rect = mode === "canvas" && area.current?.getBoundingClientRect();
    const center = rect
      ? screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        })
      : { x: 0, y: 0 };
    const columns = Math.ceil(Math.sqrt(picked.length));
    const spacingX = 424,
      spacingY = 272;
    const width = columns * spacingX;
    const height = Math.ceil(picked.length / columns) * spacingY;
    const left = center.x - width / 2;
    let top = center.y - height / 2;
    let added;
    edit((b) => {
      if (b.nodes.length + picked.length > 250)
        throw Error(
          "画布还可添加 " + (250 - b.nodes.length) + " 个节点，请减少所选素材",
        );
      // Keep the whole batch together in the nearest free rows below the viewport center.
      const nearby = b.nodes
        .filter(
          ({ position: p }) => p.x < left + width && p.x + spacingX > left,
        )
        .sort((a, other) => a.position.y - other.position.y);
      for (const { position: p } of nearby)
        if (p.y < top + height && p.y + spacingY > top) top = p.y + spacingY;
      added = picked.map((asset, i) =>
        makeNode(
          asset.kind,
          {
            x: left + (i % columns) * spacingX,
            y: top + Math.floor(i / columns) * spacingY,
          },
          { title: asset.name.slice(0, 120), assetId: asset.id },
        ),
      );
      return { ...b, nodes: [...b.nodes, ...added] };
    });
    setModal("");
    setMode("canvas");
    select(added.length === 1 ? added[0].id : "");
    requestAnimationFrame(() =>
      fitView({ nodes: added, padding: 44, maxZoom: 1 }),
    );
    notify("已将 " + added.length + " 个素材加入画布");
  }
  if (!board)
    return (
      <div className="loading">
        <p>{error || "正在读取画布…"}</p>
        <button onClick={home}>返回首页</button>
      </div>
    );
  const series = { ...defaultSeries, ...board.series };
  const sizes = ratios[series.ratio];
  const imageModel = engine?.imageModels?.find((m) => m.id === checkpoint);
  const canReference =
    engineType === "video" ? engine?.video?.needsImage : imageModel?.reference;
  const needsReference =
    engineType === "video" ? engine?.video?.needsImage : imageModel?.needsImage;
  const duration = seq.reduce((v, n) => v + n.data.duration, 0);
  const nodeAsset = node && frameAsset(node, board, assets);
  return (
    <div className="editor">
      {mode !== "canvas" && (
        <>
          <header className="edit-head">
            <button
              className="ico"
              aria-label="返回首页"
              onClick={safe(async () => {
                await flush();
                home();
              })}
            >
              <ArrowLeft size={19} />
            </button>
            <button
              className="board-name"
              title="重命名项目"
              onClick={() => {
                setRename(board.name);
                setModal("rename");
              }}
            >
              {board.name}
              <Pencil size={13} />
            </button>
            <span className="save-state">
              {status === "已保存" && <Check size={13} />} {status}
            </span>
            <div className="head-actions">
              <button
                title="使用指南"
                aria-label="使用指南"
                className="ico"
                onClick={() => setModal("guide")}
              >
                <CircleHelp size={18} />
              </button>
              <button
                title="任务记录"
                aria-label="任务记录"
                className="ico"
                onClick={() => setModal("jobs")}
              >
                <Activity size={18} />
              </button>
              <button
                title="下载画布 JSON"
                aria-label="下载画布 JSON"
                className="ico"
                onClick={() => downloadJson(board)}
              >
                <FileJson size={17} />
              </button>
              <button className="solid" onClick={() => setModal("export")}>
                <Download size={15} />
                导出 MP4
              </button>
            </div>
          </header>
          <div className="edit-tools">
            <div className="seg">
              <button
                className={mode === "canvas" ? "on" : ""}
                onClick={() => setMode("canvas")}
              >
                <Network size={15} />
                画布
              </button>
              <button
                className={mode === "sheet" ? "on" : ""}
                onClick={() => setMode("sheet")}
              >
                <ListVideo size={15} />
                分镜表
              </button>
              <button
                className={mode === "timeline" ? "on" : ""}
                onClick={() => setMode("timeline")}
              >
                <ListVideo size={15} />
                分镜台
              </button>
            </div>
            <button
              onClick={() => {
                setDraftSeries(series);
                setModal("series");
              }}
            >
              <Layers size={16} />
              剧集设定
            </button>
            <button onClick={() => setModal("add")}>
              <Plus size={16} />
              添加节点
            </button>
            <button
              onClick={() => {
                select("");
                setModal("library");
              }}
            >
              <Layers size={15} />
              素材库
            </button>
            <button
              className="preview-btn"
              disabled={!seq.length}
              onClick={() => {
                setPreview(0);
                setPlaying(true);
                setModal("preview");
              }}
            >
              <Play size={14} />
              预览
            </button>
          </div>
        </>
      )}
      <div className="edit-main">
        <div className="board-area" ref={area}>
          {mode === "canvas" ? (
            <FlowCanvas
              initialPreviewId={new URLSearchParams(query).get("view") === "compare" ? node?.data.assetId : null}
              {...{
                board,
                assets,
                selected,
                select,
                edit,
                flush,
                refresh,
                notify,
                status,
                setMode,
              }}
              update={updateNode}
              open={setModal}
              onSplit={split}
              onGenerateShot={openEngine}
              home={safe(async () => {
                await flush();
                home();
              })}
              download={() => downloadJson(board)}
              rename={() => {
                setRename(board.name);
                setModal("rename");
              }}
              onSeries={() => {
                setDraftSeries(series);
                setModal("series");
              }}
              onPreview={() => {
                setPreview(0);
                setPlaying(true);
                setModal("preview");
              }}
            />
          ) : mode === "sheet" ? (
            <ShotTable
              board={board}
              shots={seq}
              assets={assets}
              update={updateNode}
              move={move}
              add={() => add("shot")}
              remove={(n) => {
                select(n.id);
                setModal("delete");
              }}
              manage={() => setModal("cards")}
              generate={openEngine}
              linkRefs={(n) => {
                select(n.id);
                setModal("refs");
              }}
              history={(n) => {
                select(n.id);
                setModal("takes");
              }}
            />
          ) : (
            <div className="timeline">
              <div className="section-title">
                <h2>分镜台</h2>
                <small>
                  {seq.length} 镜 · {duration} 秒
                </small>
              </div>
              {seq.map((n, i) => (
                <article
                  key={n.id}
                  className={n.id === selected ? "selected" : ""}
                >
                  <button
                    className="timeline-item"
                    onClick={() => select(n.id)}
                  >
                    <span className="number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="thumb">
                      <Media asset={frameAsset(n, board, assets)} />
                    </div>
                    <span>
                      <strong>{n.data.title}</strong>
                      <small>{n.data.text}</small>
                    </span>
                  </button>
                  <b>{n.data.duration}s</b>
                  <button
                    aria-label={"上移 " + n.data.title}
                    disabled={!i}
                    onClick={() => move(n.id, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    aria-label={"下移 " + n.data.title}
                    disabled={i === seq.length - 1}
                    onClick={() => move(n.id, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </article>
              ))}
              {!seq.length && (
                <p className="empty">选中剧本节点拆镜，或添加第一个分镜。</p>
              )}
            </div>
          )}
        </div>
        {node && mode === "timeline" && (
          <aside className="inspector">
            <header>
              <b>{kinds[node.data.kind]}属性</b>
              <button aria-label="关闭属性" onClick={() => select("")}>
                <X size={16} />
              </button>
            </header>
            <label>
              节点名称
              <input
                value={node.data.title}
                maxLength={120}
                onChange={(e) => updateNode(node.id, { title: e.target.value })}
              />
            </label>
            <label>
              {node.data.kind === "script"
                ? "剧本 · 每行一个镜头"
                : "画面描述 / 提示词"}
              <textarea
                value={node.data.text}
                maxLength={40000}
                onChange={(e) => updateNode(node.id, { text: e.target.value })}
                rows={7}
              />
            </label>
            {node.data.kind === "shot" && (
              <>
                <button className="outline" onClick={() => setModal("refs")}>
                  设定引用 · {node.data.referenceIds?.length || 0}
                </button>
                <button className="outline" onClick={() => setModal("takes")}>
                  本镜候选
                </button>
              </>
            )}
            {node.data.kind === "script" && (
              <button className="solid" onClick={split}>
                <Scissors size={15} />
                拆成分镜
              </button>
            )}
            {node.data.kind === "shot" && (
              <label>
                本镜出场角色
                <textarea
                  rows={2}
                  maxLength={1500}
                  value={node.data.shotCast || ""}
                  placeholder="默认沿用剧集角色。可只写本镜的人物特征，或填「空镜，无人出场」。"
                  onChange={(e) =>
                    updateNode(node.id, { shotCast: e.target.value })
                  }
                />
              </label>
            )}
            {node.data.kind === "shot" && (
              <label>
                时长（秒）
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={node.data.duration}
                  onChange={(e) =>
                    updateNode(node.id, {
                      duration: Math.min(
                        30,
                        Math.max(1, Number(e.target.value) || 1),
                      ),
                    })
                  }
                />
              </label>
            )}
            {["shot", "image", "video", "audio"].includes(node.data.kind) && (
              <>
                <div className="inspect-media">
                  <Media asset={nodeAsset} controls />
                </div>
                <button className="outline" onClick={() => setModal("choose")}>
                  <FolderOpen size={15} />
                  {nodeAsset ? "替换素材" : "选择素材"}
                </button>
              </>
            )}
            {["shot", "image"].includes(node.data.kind) && (
              <button
                className="outline"
                onClick={() => openEngine(node, "image")}
              >
                <ImagePlus size={15} />
                ComfyUI 生图
              </button>
            )}
            {["shot", "video"].includes(node.data.kind) && (
              <button
                className="outline"
                onClick={() => openEngine(node, "video")}
              >
                <Film size={15} />
                ComfyUI 生视频
              </button>
            )}
            <button className="quiet danger" onClick={() => setModal("delete")}>
              <Trash2 size={14} />
              删除节点
            </button>
          </aside>
        )}
      </div>
      {modal === "cards" && (
        <ReferenceManager
          board={board}
          edit={edit}
          assets={assets}
          refresh={refresh}
          close={() => setModal("")}
        />
      )}
      {modal === "refs" && node && (
        <ReferencePicker
          board={board}
          shot={node}
          update={updateNode}
          close={() => setModal("")}
          manage={() => setModal("cards")}
        />
      )}
      {modal === "takes" && node && (
        <TakeHistory
          key={node.id}
          board={board}
          shot={node}
          assets={assets}
          refresh={refresh}
          adopt={safe(useTake)}
          close={() => setModal("")}
        />
      )}
      {modal === "add" && (
        <Modal title="添加节点" close={() => setModal("")}>
          <div className="node-options">
            {Object.entries(kinds).map(([k, label]) => {
              const Icon = icons[k];
              return (
                <button key={k} onClick={() => add(k)}>
                  <Icon size={22} />
                  {label}
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {["library", "choose"].includes(modal) && (
        <Modal title="素材库" close={() => setModal("")} wide>
          <Library
            projectId={board.id}
            beforeRead={flush}
            assets={assets}
            notify={notify}
            refresh={refresh}
            kinds={
              modal === "library"
                ? undefined
                : node?.data.kind === "shot"
                  ? ["image", "video"]
                  : [node?.data.kind]
            }
            onPick={modal === "choose" ? pickAsset : undefined}
            onPickMany={modal === "library" ? addLibraryAssets : undefined}
            capacity={250 - board.nodes.length}
          />
        </Modal>
      )}
      {modal === "guide" && (
        <Modal title="创作指南" close={() => setModal("")}>
          <Guide />
        </Modal>
      )}
      {modal === "series" && (
        <Modal title="剧集设定" close={() => setModal("")}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setWorking(true);
              try {
                edit((b) => ({ ...b, series: draftSeries }));
                await flush();
                setModal("");
              } catch (err) {
                setDialogError(err.message);
              } finally {
                setWorking(false);
              }
            }}
          >
            <SeriesFields
              value={draftSeries}
              onChange={setDraftSeries}
              assets={assets}
            />
            {dialogError && <p role="alert">{dialogError}</p>}
            <button className="solid" disabled={working}>
              保存剧集设定
            </button>
            <button
              type="button"
              className="outline"
              disabled={working}
              onClick={() => {
                setNextName("");
                setNextScript("");
                setModal("episode");
              }}
            >
              沿用这些设定创建下一集
            </button>
          </form>
        </Modal>
      )}
      {modal === "episode" && (
        <Modal title="创建下一集" close={() => setModal("series")}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setWorking(true);
              try {
                await flush();
                const fresh = await api("/projects", "POST", {
                  name: nextName.trim(),
                  script: nextScript,
                  series: draftSeries,
                  referenceCards: board.referenceCards,
                });
                location.hash = "project/" + fresh.id;
              } catch (err) {
                setDialogError(err.message);
              } finally {
                setWorking(false);
              }
            }}
          >
            <p>
              沿用当前填写的角色、画风、世界、画幅和参考图。这一集从自己的剧本开始。
            </p>
            <label>
              新一集名称
              <input
                autoFocus
                required
                maxLength={100}
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
              />
            </label>
            <ScriptField value={nextScript} onChange={setNextScript} />
            {dialogError && <p role="alert">{dialogError}</p>}
            <button className="solid" disabled={working || !nextName.trim()}>
              创建并打开
            </button>
          </form>
        </Modal>
      )}
      {modal === "rename" && (
        <Modal title="重命名项目" close={() => setModal("")}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (rename.trim()) {
                edit((b) => ({ ...b, name: rename.trim() }));
                setModal("");
              }
            }}
          >
            <label>
              项目名称
              <input
                autoFocus
                maxLength={100}
                required
                value={rename}
                onChange={(e) => setRename(e.target.value)}
              />
            </label>
            <button className="solid">保存名称</button>
          </form>
        </Modal>
      )}
      {modal === "delete" && (
        <Modal title="删除这个节点？" close={() => setModal("")}>
          <p>「{node?.data.title}」和与它相连的线会从此画布移除。</p>
          <button className="solid destructive" onClick={removeNode}>
            确认删除节点
          </button>
        </Modal>
      )}
      {modal === "jobs" && (
        <Modal title="项目任务" close={() => setModal("")}>
          <Jobs
            rows={jobs}
            assets={assets}
            onUse={(a) => add(a.kind, a)}
            onTake={safe(useTake)}
            onApply={node?.data.kind === "shot" ? pickAsset : undefined}
          />
        </Modal>
      )}
      {modal === "environment" && (
        <EnvironmentSettings close={() => setModal("")} notify={notify} />
      )}
      {modal === "engine" && (
        <Modal
          title={engineType === "video" ? "ComfyUI 生视频" : "ComfyUI 生图"}
          close={() => setModal("")}
        >
          <div className="form">
            {!engine ? (
              <p>正在读取模型列表…</p>
            ) : !engine.online ||
              (engineType === "image" && !engine.imageModels?.length) ? (
              <p>
                {engine.online
                  ? engine.imageError ||
                    "服务已连接。当前模型需要配置匹配的图片工作流。"
                  : "当前未连接生成服务，请检查服务端 COMFYUI_URL。"}
              </p>
            ) : engineType === "video" && !engine.video ? (
              <p>
                {engine.videoError ||
                  "未配置视频工作流。请按 README 设置 COMFYUI_VIDEO_WORKFLOW，选择当前 ComfyUI 可以运行的文生视频或图生视频工作流。"}
              </p>
            ) : (
              <>
                {engineType === "image" && (
                  <label>
                    图片生成工作流
                    <Select
                      value={checkpoint}
                      onValueChange={(next) => setCheckpoint(next)}
                    >
                      {engine.imageModels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {engineType === "video" && (
                  <p>
                    {engine.video.name} · {series.ratio}
                    {engine.video.native && " · 单次生成约 1–5 秒"}
                  </p>
                )}
                {canReference && (
                  <label>
                    参考图
                    <Select
                      value={reference}
                      onValueChange={(next) => setReference(next)}
                    >
                      <option value="">
                        {needsReference ? "选择参考图" : "仅使用提示词"}
                      </option>
                      {referencesForShot(board, node.data).some(
                        (c) => c.imageId,
                      ) && (
                        <optgroup label="本镜设定参考图">
                          {referencesForShot(board, node.data)
                            .filter((c) => c.imageId)
                            .map((c) => (
                              <option key={c.id} value={c.imageId}>
                                {referenceTypes[c.type]} · {c.name}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {assets
                        .filter(
                          (a) =>
                            a.kind === "image" &&
                            !referencesForShot(board, node.data).some(
                              (c) => c.imageId === a.id,
                            ),
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </Select>
                  </label>
                )}
                {node.data.kind === "shot" && (
                  <small>
                    {canReference
                      ? "所选设定的文字进入提示词，本工作流可再输入一张参考图。"
                      : "此工作流使用所选设定的文字描述。"}
                  </small>
                )}
                <label>
                  画面描述
                  <textarea
                    rows={4}
                    value={node.data.text}
                    onChange={(e) =>
                      updateNode(node.id, { text: e.target.value })
                    }
                  />
                </label>
                <details className="series-disclosure">
                  <summary>实际提交的提示词 · {series.ratio}</summary>
                  <pre>
                    {node.data.kind === "shot"
                      ? shotPrompt(board, node.data, engineType)
                      : seriesPrompt(
                          series,
                          node.data.text,
                          node.data.shotCast,
                        )}
                  </pre>
                </details>
                {engineType === "image" && engine.imageError && (
                  <small>{engine.imageError}</small>
                )}
                {dialogError && <p role="alert">{dialogError}</p>}
                <button
                  className="solid"
                  disabled={
                    working ||
                    !node.data.text.trim() ||
                    (needsReference && !reference)
                  }
                  onClick={() => submit("generate")}
                >
                  提交生成任务
                </button>
              </>
            )}
            {engine?.unavailable?.length > 0 && (
              <details>
                <summary>当前环境中不可用的预设</summary>
                {engine.unavailable.map((m) => (
                  <p key={m.id}>
                    {m.name} · {m.reason}
                  </p>
                ))}
              </details>
            )}
            {engine?.online && <Inventory inventory={engine.inventory} />}
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal title="导出成片" close={() => setModal("")}>
          <div className="form">
            <p>
              {seq.length} 个镜头 · {duration} 秒 · {sizes.output.join(" × ")} ·
              H.264 MP4
            </p>
            <label>
              全片配乐
              <Select value={audio} onValueChange={(next) => setAudio(next)}>
                <option value="">保留镜头原声</option>
                {assets
                  .filter((a) => a.kind === "audio")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </label>
            <small>
              按分镜台顺序拼接。短视频素材会循环至镜头结束，默认保留镜头原声。选择全片配乐会替换原声。
            </small>
            {dialogError && <p role="alert">{dialogError}</p>}
            <button
              className="solid"
              disabled={working || !seq.length}
              onClick={() => submit("export")}
            >
              开始导出
            </button>
          </div>
        </Modal>
      )}
      {modal === "preview" && seq[preview] && (
        <Modal
          title={"分镜预览 · " + (preview + 1) + " / " + seq.length}
          wide
          close={() => {
            setPlaying(false);
            setModal("");
          }}
        >
          <div
            className="player"
            key={preview}
            style={{
              aspectRatio: series.ratio.replace(":", "/"),
              maxWidth:
                "min(100%, " +
                (sizes.output[0] / sizes.output[1]) * 62 +
                "dvh)",
              marginInline: "auto",
            }}
          >
            <Media
              asset={frameAsset(seq[preview], board, assets)}
              autoPlay={playing}
              muted
              loop
            />
            {!frameAsset(seq[preview], board, assets) && <Film size={40} />}
          </div>
          <div className="playbar">
            <button
              aria-label="上一镜"
              disabled={!preview}
              onClick={() => setPreview((i) => i - 1)}
            >
              <ChevronLeft />
            </button>
            <button
              onClick={() => {
                if (!playing && preview === seq.length - 1) setPreview(0);
                setPlaying(!playing);
              }}
            >
              {playing ? "暂停" : "播放"}
            </button>
            <button
              aria-label="下一镜"
              disabled={preview === seq.length - 1}
              onClick={() => setPreview((i) => i + 1)}
            >
              <ChevronRight />
            </button>
            <b>{seq[preview].data.title}</b>
            <small>{seq[preview].data.duration} 秒</small>
          </div>
          <p>{seq[preview].data.text}</p>
        </Modal>
      )}
    </div>
  );
}
