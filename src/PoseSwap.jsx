import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, ImagePlus, Upload, X } from "lucide-react";
import { poseSwapRoles } from "../shared/pose-swap";
import { api, uploadAsset } from "./client";
import { Library } from "./library";
import { Select } from "./Select";
import { AssetPreview, Modal } from "./ui";
import "./pose-swap.css";

const librarySource = "https://github.com/JGRFW/comfyui-aicg3d-PoseSwap/blob/main/THIRD_PARTY_NOTICES.md";
const libraryNotes = {
  person: "上游人像为 AI 生成的虚构模特。",
  pose: "上游姿势图库标注为非商用。",
  outfit: "上游服装图库的再分发许可尚不明确。",
};
const batchSize = 24;

function pageLinks(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "after", pages];
  if (page >= pages - 3) return [1, "before", pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, "before", page - 1, page, page + 1, "after", pages];
}

function GalleryPagination({ page, pages, disabled, onPage }) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  function goTo(next) {
    setDraft("");
    setInvalid(false);
    onPage(next);
  }
  function jump(event) {
    event.preventDefault();
    const text = draft.normalize("NFKC").trim();
    const next = Number(text);
    if (!/^\d+$/.test(text) || next < 1 || next > pages) {
      setInvalid(true);
      return;
    }
    goTo(next);
  }
  return (
    <>
      <nav className="pose-page-links" aria-label="图库分页">
        <button type="button" aria-label="上一页" title="上一页" disabled={page === 1 || disabled}
          onClick={() => goTo(page - 1)}><ChevronLeft size={17} /></button>
        {pageLinks(page, pages).map((item) => typeof item === "number" ? (
          <button type="button" key={item} aria-label={"第 " + item + " 页"}
            aria-current={page === item ? "page" : undefined} disabled={disabled}
            onClick={() => goTo(item)}>{item}</button>
        ) : <span key={item} className="pose-page-ellipsis" aria-hidden="true">…</span>)}
        <button type="button" aria-label="下一页" title="下一页" disabled={page === pages || disabled}
          onClick={() => goTo(page + 1)}><ChevronRight size={17} /></button>
      </nav>
      <form className="pose-page-jump" onSubmit={jump}>
        <label>
          跳至
          <input aria-label="跳转页码" inputMode="numeric" autoComplete="off" value={draft}
            placeholder="页码" disabled={disabled} aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => { setDraft(event.target.value); setInvalid(false); }} />
        </label>
        <button type="submit" aria-label="跳转" title="跳转（回车）" disabled={disabled || !draft.trim()}>
          <ArrowRight size={15} />
        </button>
        {invalid && <small id={errorId} className="pose-page-jump-error" role="alert">请输入 1–{pages} 的页码</small>}
      </form>
    </>
  );
}

export function PoseSwapEditor({ roles, refs, assets, projectId, refresh, notify, assign, disabled, notes, setNotes }) {
  const [role, setRole] = useState("");
  const [preview, setPreview] = useState(null);
  return (
    <>
      <div className="pose-swap-roles" role="group" aria-label="PoseSwap 参考图">
        {Object.entries(poseSwapRoles).map(([key, label]) => {
          const reference = roles[key];
          return (
            <div className="pose-swap-slot" key={key}>
              <div className="pose-swap-slot-title">
                <b>{label}</b>
                {reference && <button type="button" aria-label={"移除" + label} disabled={disabled}
                  onClick={() => assign(key, {})}><X size={14} /></button>}
              </div>
              {reference ? (
                <button type="button" className="pose-swap-thumb" onClick={() => setPreview(reference.asset)}
                  aria-label={"预览" + label + "参考图"}>
                  <img src={reference.asset.url} alt={reference.title} />
                </button>
              ) : (
                <button type="button" className="pose-swap-thumb pose-swap-empty" disabled={disabled}
                  aria-label={"添加" + label + "参考图"} onClick={() => setRole(key)}><ImagePlus size={22} /></button>
              )}
              <button className="outline pose-swap-pick" type="button" disabled={disabled}
                onClick={() => setRole(key)}>{reference ? "更换" : "选择"}{label}</button>
            </div>
          );
        })}
      </div>
      <label className="pose-swap-notes">
        补充要求（可选）
        <textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="如保留靴子、保持原背景…" />
      </label>
      {role && <ReferencePicker key={role} {...{ role, refs, assets, projectId, refresh, notify }}
        onUse={(ref) => assign(role, ref)} close={() => setRole("")} />}
      {preview && <AssetPreview asset={preview} assets={assets} close={() => setPreview(null)} />}
    </>
  );
}

function ReferencePicker({ role, refs, assets, projectId, refresh, notify, onUse, close }) {
  const [tab, setTab] = useState("gallery");
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [both, setBoth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [galleryError, setGalleryError] = useState("");
  const [error, setError] = useState("");
  const [reload, retry] = useState(0);
  const input = useRef(null);
  const grid = useRef(null);
  useEffect(() => {
    if (tab !== "gallery" || rows) return;
    const request = new AbortController();
    setGalleryError("");
    api("/pose-swap/gallery/" + role, "GET", undefined, request.signal)
      .then(setRows, (reason) => {
        if (!request.signal.aborted) setGalleryError(reason.message);
      });
    return () => request.abort();
  }, [role, tab, rows, reload]);
  useLayoutEffect(() => {
    if (grid.current) grid.current.scrollTop = 0;
  }, [tab, page, query, category]);

  async function useAsset(load) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const asset = await load();
      if (asset.kind !== "image") throw Error("请选择图片文件");
      onUse({ asset, both });
      close();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = (rows || []).filter((row) => {
    const searchable = [row.title, row.category, row.keywords, row.id].join(" ").toLowerCase();
    return (!category || row.category === category) && keywords.every((k) => searchable.includes(k));
  });
  const pages = Math.max(1, Math.ceil(visible.length / batchSize));
  const start = (page - 1) * batchSize;
  const items = visible.slice(start, start + batchSize);
  const categories = [...new Set((rows || []).map((row) => row.category).filter(Boolean))];
  return (
    <Modal wide title={"选择" + poseSwapRoles[role]} close={() => { if (!busy) close(); }}>
      <div className="pose-gallery">
        <div className="pose-gallery-tools">
          <div className="filters" role="group" aria-label="参考来源">
            {[["gallery", "PoseSwap 图库"], ["canvas", "画布参考"], ["library", "我的素材"]].map(([key, title]) =>
              <button type="button" key={key} aria-pressed={tab === key} disabled={busy}
                className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{title}</button>)}
          </div>
          <button className="outline" type="button" disabled={busy} onClick={() => input.current.click()}>
            <Upload size={15} />上传照片
          </button>
          <input type="file" hidden ref={input} accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const [file] = e.target.files;
              e.target.value = "";
              if (file) useAsset(() => uploadAsset(file, projectId));
            }} />
        </div>
        {role !== "person" && <label className="pose-gallery-both">
          <input type="checkbox" checked={both} disabled={busy} onChange={(e) => setBoth(e.target.checked)} />
          {role === "pose" ? "同一张图也用作服装参考" : "同一张图也用作姿势参考"}
        </label>}
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">正在准备参考图…</p>}
        {tab === "gallery" && (
          <>
            <div className="pose-gallery-tools">
              <input aria-label="搜索 PoseSwap 图库" placeholder="搜索名称、动作或款式" value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
              <Select value={category} onValueChange={(value) => { setCategory(value); setPage(1); }}
                aria-label="图库分类">
                <option value="">全部分类</option>
                {categories.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </div>
            <div className="pose-gallery-grid" ref={grid} aria-label="图库素材">
              {galleryError ? <p className="pose-gallery-message" role="alert">
                {galleryError} <button type="button" className="outline" onClick={() => retry(n => n + 1)}>重试</button>
              </p> : !rows ? <p className="pose-gallery-message" role="status">正在读取图库…</p>
                : !items.length && <p className="empty pose-gallery-message">没有匹配的素材。</p>}
              {items.map((item) => <button type="button" className="pose-gallery-card" key={item.id} disabled={busy}
                onClick={() => useAsset(() => api("/pose-swap/gallery/" + role + "/" + item.id, "POST", { projectId }))}
                title={item.title}>
                <img src={item.thumbnail} loading="lazy" referrerPolicy="no-referrer" alt="" />
                <b>{item.title}</b>
                {item.category && <small>{item.category}</small>}
              </button>)}
            </div>
            <div className="pose-gallery-footer">
              <div className="pose-gallery-pagination">
                <span className="pose-page-count" aria-live="polite">
                  {items.length > 0
                    ? `${start + 1}–${start + items.length} / 共 ${visible.length.toLocaleString("zh-CN")} 项`
                    : rows && "共 0 项"}
                </span>
                {pages > 1 && <GalleryPagination key={JSON.stringify([query, category])}
                  page={page} pages={pages} disabled={busy} onPage={setPage} />}
              </div>
              <small className="pose-gallery-note">{libraryNotes[role]} <a href={librarySource}
                target="_blank" rel="noreferrer">素材来源与使用说明</a></small>
            </div>
          </>
        )}
        {tab === "canvas" && (
          refs.length ? <div className="pose-gallery-grid">
            {refs.map((ref) => <button type="button" className="pose-gallery-card" key={ref.id} disabled={busy}
              onClick={() => {
                try {
                  onUse({ id: ref.id, both });
                  close();
                } catch (e) {
                  setError(e.message);
                }
              }}>
              <img src={ref.asset.url} alt="" /><b>{ref.title}</b>
            </button>)}
          </div> : <p className="empty">连接一张上游图片，或从图库、素材库选择。</p>
        )}
        {tab === "library" && <Library {...{ assets, refresh, notify, projectId }} kinds={["image"]}
          onPick={(asset) => useAsset(() => asset)} />}
      </div>
    </Modal>
  );
}
