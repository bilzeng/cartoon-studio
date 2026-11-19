import { JobTiming } from "./JobTiming";
import { queueLabel } from "../shared/job-timing";
import { CancelGeneration } from "./CancelGeneration";
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Download, FolderOpen, LoaderCircle, Star, Upload } from "lucide-react";
import { api, uploadAsset } from "./client";
import { AssetPreview, Media } from "./ui";
import { AssetTagEditor } from "./AssetTagEditor";
import { visibleTags } from "../shared/asset-tags.js";
import { useAssetRange } from "./useAssetRange";

const pageSize = 20;
export function Library({
  assets,
  refresh,
  onPick,
  onPickMany,
  beforeRead,
  projectId,
  projects = [],
  capacity = 250,
  kinds = ["image", "video", "audio"],
  notify,
}) {
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [importResult, setImportResult] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [completed, setCompleted] = useState(0);
  const [uploadCount, setUploadCount] = useState(0);
  const chooser = useRef(null);
  const importTags = useRef([]);
  const [tagTarget, setTagTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [scope, setScope] = useState("all"), [tag, setTag] = useState("");
  const [page, setPage] = useState(1);
  const [savingStars, setSavingStars] = useState(new Set());
  const grid = useRef(null);
  const { range, handlers } = useAssetRange(ids => mark(ids, true));
  const checkedIds = range ? new Set([...selected, ...range.ids]) : selected;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      await beforeRead?.();
      const rows = await api("/assets/library", "GET", undefined, controller.signal);
      if (!controller.signal.aborted) setCatalog(rows);
    }
    load().catch(e => { if (!controller.signal.aborted) setFeedback(e.message); });
    return () => controller.abort();
  }, [assets, beforeRead]);

  async function toggleFavorite(asset) {
    setSavingStars(ids => new Set(ids).add(asset.id));
    try {
      const { favorite } = await api("/assets/" + asset.id + "/favorite", "PUT", { favorite: !asset.favorite });
      setCatalog(rows => rows?.map(a => a.id === asset.id ? { ...a, favorite } : a));
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setSavingStars(ids => { const next = new Set(ids); next.delete(asset.id); return next; });
    }
  }
  function chooseFiles(tags) {
    importTags.current = tags;
    chooser.current.click();
  }
  async function saveTags(edits) {
    if (tagTarget.importing) {
      chooseFiles(edits.add);
      return;
    }
    if (!Object.values(edits).some(values => values.length)) return;
    const ids = tagTarget.ids || [tagTarget.asset.id];
    const changes = await api("/assets/tags", "PATCH", { ids, ...edits });
    const byId = new Map(changes.map(row => [row.id, row]));
    setCatalog(rows => rows?.map(a => {
      const change = byId.get(a.id);
      return change ? { ...a, ...change, tags: visibleTags(a.autoTags, change.customTags, change.hiddenTags) } : a;
    }));
    notify("已保存标签");
  }
  const names = new Map(projects.map(p => [p.id, p.name]));
  const openFolder = (route) => api(route, "POST").catch(e => notify(e.message));
  const query = search.trim().toLowerCase();
  const matching = (catalog || assets).filter(
    (a) =>
      kinds.includes(a.kind) &&
      (filter === "all" || a.kind === filter) &&
      (scope !== "favorites" || a.favorite) && (scope !== "recent" || a.lastUsed) &&
      (a.name.toLowerCase().includes(query) || a.tags?.some(t => t.toLowerCase().includes(query))),
  );
  const tags = [...new Set(matching.flatMap(a => a.tags || []))];
  const activeTag = tags.includes(tag) ? tag : "";
  const visible = matching.filter(a => !activeTag || a.tags.includes(activeTag));
  if (scope === "recent") visible.sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageItems = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function filterTag(next) {
    setTag(next);
    setPage(1);
  }
  function changePage(next) {
    setPage(next);
    if (!onPickMany && !onPick) grid.current?.scrollIntoView({ block: "start" });
  }
  useEffect(() => {
    if (grid.current) grid.current.scrollTop = 0;
  }, [currentPage, scope, filter, activeTag, search]);
  const allVisibleSelected =
    visible.length > 0 && visible.every((a) => selected.has(a.id));
  function mark(ids, checked) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }
  function addSelection() {
    const byId = new Map([...(catalog || []), ...assets].map((a) => [a.id, a]));
    const picked = Array.from(selected, (id) => byId.get(id));
    try {
      if (picked.some((a) => !a)) throw Error("有素材已移除，请清空后重新选择");
      onPickMany(picked);
    } catch (error) {
      setFeedback(error.message);
    }
  }
  async function upload(files, tags) {
    if (!files.length || busy) return;
    setFeedback("");
    setImportResult("");
    setBusy(true);
    setCompleted(0);
    setUploadCount(files.length);
    const added = [], duplicates = [], failures = [];
    try {
      for (const file of files) {
        try {
          if (file.size > 64 * 1024 * 1024) throw Error("超过 64 MB");
          const asset = await uploadAsset(file, projectId, tags);
          if (asset.duplicate) duplicates.push(asset.name);
          else added.push(asset.id);
        } catch (e) {
          failures.push(file.name + "：" + e.message);
        }
        setCompleted((n) => n + 1);
      }
      if (added.length || duplicates.length) await refresh();
      if (onPickMany) mark(added, true);
      if (files.length === 1 && duplicates.length) setImportResult("素材已存在：" + duplicates[0]);
      else if (added.length || duplicates.length) setImportResult("已导入 " + added.length + " 个素材" +
        (duplicates.length ? "，跳过 " + duplicates.length + " 个重复文件" : ""));
      if (failures.length) setFeedback("导入失败：" + failures.join("；"));
    } catch (e) {
      setFeedback(e.message);
      notify(e.message);
    } finally {
      setBusy(false);
      if (chooser.current) chooser.current.value = "";
    }
  }
  return (
    <div className={"library" + (onPickMany || onPick ? " library-picker" : "") + (onPickMany ? " library-batch" : "")}>
      <div className="tools">
        <input
          placeholder="搜索素材"
          aria-label="搜索素材"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setTag(""); setPage(1); }}
        />
        {!onPick && !onPickMany && (
          <button className="outline library-folder" onClick={() => openFolder("/assets/folder")}>
            <FolderOpen size={15} />打开资产目录
          </button>
        )}
        <button className="outline" disabled={busy} onClick={() => setTagTarget({ importing: true })}>带标签导入</button>
        <button
          className="solid"
          disabled={busy}
          onClick={() => chooseFiles([])}
        >
          <Upload size={15} />
          {busy ? `导入中 ${completed}/${uploadCount}` : "导入素材"}
        </button>
        <input
          hidden
          ref={chooser}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,audio/wav,audio/mpeg,audio/mp4"
          onChange={(e) => upload(Array.from(e.target.files), importTags.current)}
        />
      </div>
      {importResult && <p className="library-import-result" role="status">{importResult}</p>}
      {feedback && <p role="alert">{feedback}</p>}
      <div className="library-filters"><div className="filters" role="group" aria-label="素材类型">
        {["all", ...kinds].map((k) => (
          <button
            className={filter === k ? "active" : ""}
            aria-pressed={filter === k}
            key={k}
            onClick={() => { setFilter(k); setTag(""); setPage(1); }}
          >
            {{ all: "全部", image: "图片", video: "视频", audio: "音频" }[k]}
          </button>
        ))}
      </div><div className="filters" role="group" aria-label="收藏与使用记录">
        {[[Star, "favorites", "我的收藏"], [Clock3, "recent", "最近使用"]].map(([Icon, key, label]) => (
          <button key={key} className={scope === key ? "active" : ""} aria-pressed={scope === key}
            onClick={() => { setScope(scope === key ? "all" : key); setTag(""); setPage(1); }}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div></div>
      {tags.length > 0 && <div className="library-tags" role="group" aria-label="素材标签">
        {["", ...tags].map(t => <button key={t} aria-pressed={activeTag === t}
          onClick={() => filterTag(t)}>{t || "全部标签"}</button>)}
      </div>}
      <div ref={grid} className="asset-grid" {...(onPickMany ? handlers : {})}>
        {pageItems.map((a) => (
          <article
            key={a.id}
            data-asset-id={a.id}
            data-picked={(onPickMany && checkedIds.has(a.id)) || undefined}
          >
            <button className="asset-favorite" aria-label={"收藏 " + a.name} aria-pressed={!!a.favorite}
              title={a.favorite ? "取消收藏" : "收藏素材"} disabled={!catalog || savingStars.has(a.id)}
              onClick={() => toggleFavorite(a)}><Star size={15} /></button>
            {a.kind === "image" || onPickMany || onPick ? (
              <button className="asset-thumb asset-preview" aria-label={"预览 " + a.name}
                onClick={() => setPreview(a)}>
                <Media asset={a} />
              </button>
            ) : (
              <div className="asset-thumb"><Media asset={a} controls /></div>
            )}
            <strong className="asset-title" title={a.name}>{a.name}</strong>
            <div className="asset-labels" title={a.tags?.join(" · ")}>
              {a.tags?.slice(0, 2).map(t => <button key={t} aria-label={"筛选标签：" + t}
                onClick={() => filterTag(t)}>{t}</button>)}
              {a.tags?.length > 2 && <small title={a.tags.slice(2).join(" · ")}>+{a.tags.length - 2}</small>}
              <button className="asset-edit-tags" aria-label={"编辑标签：" + a.name} disabled={!catalog}
                onClick={() => setTagTarget({ asset: a })}>编辑标签</button>
            </div>
            {!onPick && !onPickMany && (
              <small className="asset-source" title={names.get(a.projectId)}>
                {names.get(a.projectId) || (a.builtin ? "内置示例" : "公共素材")}
              </small>
            )}
            <footer className="asset-actions">
              {onPickMany ? (
                <label>
                  <input type="checkbox" aria-label={"选择 " + a.name} checked={checkedIds.has(a.id)}
                    onChange={e => mark([a.id], e.target.checked)} />
                  {checkedIds.has(a.id) ? "已选择" : "选择"}
                </label>
              ) : onPick ? (
                <button className="outline" onClick={() => onPick(a)}>使用素材</button>
              ) : (
                <>
                  <a href={a.url} download={a.diskFile?.split("/").at(-1) || a.name}>
                    <Download size={14} />下载
                  </a>
                  <button className="quiet" aria-label={"打开所在目录：" + a.name}
                    title={"data/media/" + a.diskFile} onClick={() => openFolder("/assets/" + a.id + "/folder")}>
                    <FolderOpen size={15} />
                  </button>
                </>
              )}
            </footer>
          </article>
        ))}
        {range && <span aria-hidden="true" className="asset-range" style={range.style} />}
      </div>
      {preview && <AssetPreview asset={assets.find(a => a.id === preview.id) || preview} assets={assets} projectId={projectId} close={() => setPreview(null)} />}
      {tagTarget && <AssetTagEditor target={tagTarget}
        vocabulary={[...new Set((catalog || []).flatMap(a => a.tags))].sort((a, b) => a.localeCompare(b, "zh-CN"))}
        onSave={saveTags} close={() => setTagTarget(null)} />}
      {!visible.length && (
        <p className="empty">{scope === "favorites" ? "没有匹配的收藏。点击素材右上角的星标即可收藏。" :
          scope === "recent" ? "没有匹配的使用记录。" : "没有匹配的素材，可以调整筛选或导入文件。"}</p>
      )}
      <div className="library-page">
        {onPickMany && <span className="range-hint">拖动框选<span>，从勾选区起拖可跨行</span></span>}
        <span>共 {visible.length} 项</span>
        <nav aria-label="素材分页">
          <button className="quiet" aria-label="上一页" disabled={currentPage === 1}
            onClick={() => changePage(currentPage - 1)}><ChevronLeft size={16} /></button>
          <span aria-live="polite">{currentPage} / {pages}</span>
          <button className="quiet" aria-label="下一页" disabled={currentPage === pages}
            onClick={() => changePage(currentPage + 1)}><ChevronRight size={16} /></button>
        </nav>
      </div>
      {onPickMany && (
        <div className="asset-batch-actions">
          <button
            className="outline"
            disabled={!visible.length}
            onClick={() =>
              mark(
                visible.map((a) => a.id),
                !allVisibleSelected,
              )
            }
          >
            {allVisibleSelected ? "取消全选当前结果" : "全选当前结果"}
          </button>
          {selected.size > 0 && (
            <>
              <button className="outline" disabled={!catalog}
                onClick={() => setTagTarget({ ids: [...selected] })}>批量加标签</button>
              <button className="quiet" onClick={() => setSelected(new Set())}>清空选择</button>
            </>
          )}
          <span role="status">
            {checkedIds.size > capacity
              ? "画布还可添加 " + capacity + " 个节点"
              : "已选 " + checkedIds.size + " 项"}
          </span>
          <button
            className="solid"
            onClick={addSelection}
            disabled={busy || !selected.size || selected.size > capacity}
          >
            加入画布{checkedIds.size ? "（" + checkedIds.size + "）" : ""}
          </button>
        </div>
      )}
    </div>
  );
}
export function Jobs({ rows, assets, onUse, onApply, onTake, refresh, notify }) {
  return (
    <div className="jobs">
      {!rows.length && (
        <div className="empty">
          <FolderOpen />
          <p>还没有任务。导出成片或生成图片后，可以在这里查看进度。</p>
        </div>
      )}
      {rows.map((j) => {
        const asset = assets.find((a) => a.id === j.assetId);
        return (
          <article key={j.id}>
            <div className="job-top">
              <strong>
                {j.title && j.title + " · "}
                {
                  {
                    export: "成片导出",
                    image: "ComfyUI 生图",
                    video: "ComfyUI 生视频",
                    audio: "ComfyUI 音频",
                  }[j.type]
                }
              </strong>
              <span className={"status " + j.status}>
                {j.status === "running" && (
                  <LoaderCircle className="spin" size={13} />
                )}
                {
                  queueLabel(j) || { running: "处理中", done: "已完成", failed: "失败", cancelled: "已取消" }[
                    j.status
                  ]
                }
              </span>
              {j.status === "running" && (j.type !== "export" || j.phase === "waiting") && (
                <CancelGeneration jobId={j.id} className="outline" onCancelled={refresh} onError={notify} />
              )}
            </div>
            <p>{j.detail}</p>
            <JobTiming job={j} />
            <small>{new Date(j.created).toLocaleString("zh-CN")}</small>
            {asset && (
              <div className="job-links">
                <a href={asset.url} download={asset.name}>
                  <Download size={14} />
                  下载
                  {{ video: "视频", audio: "音频", image: "图片" }[asset.kind]}
                </a>
                {j.shotId && onTake && (
                  <button className="outline" onClick={() => onTake(j)}>用于原分镜</button>
                )}
                {!j.shotId &&
                  onApply &&
                  ["image", "video"].includes(j.type) && (
                    <button className="outline" onClick={() => onApply(asset)}>用于所选分镜</button>
                  )}
                {onUse && (
                  <button className="outline" onClick={() => onUse(asset)}>放入画布</button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
