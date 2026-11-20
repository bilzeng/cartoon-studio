import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PanoramaViewer } from "./PanoramaViewer";
import { RestoreComparison, restoreOriginal } from "./RestoreComparison";
import { AssetFileActions } from "./AssetFileActions";
import {
  Box,
  AtSign,
  Aperture,
  ArrowUpRight,
  AudioLines,
  Clapperboard,
  FileText,
  Image,
  LayoutDashboard,
  ListVideo,
  Play,
  ScrollText,
  Video,
  X,
} from "lucide-react";
export const icons = {
  stage: Box,
  script: ScrollText,
  text: FileText,
  shot: Clapperboard,
  image: Image,
  video: Video,
  audio: AudioLines,
};
export function Mark() {
  return (
    <span className="brand">
      <Aperture size={27} />
      <span>
        镜场 <i>Studio</i>
      </span>
    </span>
  );
}
export function Media({ asset, controls = false, ...props }) {
  const video = useRef(null);
  useEffect(() => {
    if (!video.current || props.autoPlay === undefined) return;
    if (props.autoPlay) video.current.play().catch(() => {});
    else video.current.pause();
  }, [asset?.id, props.autoPlay]);
  if (!asset) return null;
  if (asset.kind === "video")
    return (
      <video
        ref={video}
        src={asset.url}
        controls={controls}
        playsInline
        preload="metadata"
        {...props}
      />
    );
  if (asset.kind === "audio")
    return controls ? (
      <audio src={asset.url} controls preload="metadata" {...props} />
    ) : (
      <span className="audio-art">
        <AudioLines size={36} />
      </span>
    );
  return <img src={asset.url} alt={asset.name} {...props} />;
}
export function AssetPreview({ asset, assets = [], projectId, label = asset.name, caption = label, close, insert, panorama = asset.panorama }) {
  const original = restoreOriginal(asset, assets);
  const videoCompare = original?.kind === "video";
  const [controlsHost, setControlsHost] = useState(null);
  const [startTime] = useState(() => videoCompare
    ? Array.from(document.querySelectorAll(".flow-tile video[data-restored-video]"))
        .find(video => video.dataset.restoredVideo === asset.id)?.currentTime : 0);
  const spherical = asset.kind === "image" && (panorama || original?.panorama);
  const dialog = useRef(null);
  const stage = useRef(null);
  const pan = useRef(null);
  const [actualSize, setActualSize] = useState(false);
  useLayoutEffect(() => {
    const area = stage.current;
    if (area && actualSize && !spherical) {
      area.querySelector('[role="slider"]')?.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    }
  }, [actualSize, spherical]);
  function startPan(e) {
    if (!actualSize || spherical || e.pointerType === "touch" || e.button !== 0 || !e.isPrimary ||
        e.target.closest('[role="slider"]') || !e.target.closest(".restore-comparison")) return;
    const area = e.currentTarget;
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: area.scrollLeft, top: area.scrollTop };
    area.setPointerCapture(e.pointerId);
  }
  function movePan(e) {
    const start = pan.current;
    if (start?.id !== e.pointerId) return;
    e.currentTarget.scrollLeft = start.left + start.x - e.clientX;
    e.currentTarget.scrollTop = start.top + start.y - e.clientY;
  }
  useLayoutEffect(() => {
    const el = dialog.current;
    if (videoCompare) {
      document.querySelectorAll(".flow-tile video[data-restored-video]").forEach(video => video.pause());
    }
    el.showModal();
    return () => el.close();
  }, []);
  return createPortal(
    <dialog ref={dialog} className="reference-viewer" data-compare={original ? true : undefined} aria-label={label + " 素材预览"}
      onCancel={(e) => { e.preventDefault(); close(); }}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) close(); }}>
      <button className="viewer-close" autoFocus aria-label="关闭预览" onClick={close}><X size={21} /></button>
      {original ? <>
        <strong className="restore-viewer-heading">{spherical ? "360° 全景修复对比" : "修复对比"}</strong>
        <div className="restore-zoom" role="group" aria-label="对比缩放">
          <button type="button" aria-pressed={!actualSize} onClick={() => setActualSize(false)}>{spherical ? "标准视角" : "适应窗口"}</button>
          <button type="button" aria-pressed={actualSize} onClick={() => setActualSize(true)}>{spherical ? "2×" : "100%"}</button>
        </div>
        <div ref={stage} className="restore-viewer-stage" data-panorama={spherical || undefined} data-actual={actualSize && !spherical || undefined}
          onPointerDown={startPan} onPointerMove={movePan} onLostPointerCapture={() => { pan.current = null; }}>
          <div className="restore-viewer-mat" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            <RestoreComparison key={asset.id} original={original} restored={asset} expanded actualSize={actualSize} panorama={spherical}
              controlsHost={controlsHost} startTime={startTime} />
          </div>
        </div>
      </> : panorama && asset.kind === "image" ? <PanoramaViewer key={asset.id} asset={asset} /> : <Media asset={asset} controls />}
      {videoCompare && <div className="restore-viewer-transport" ref={setControlsHost} />}
      <div className="viewer-caption">
        <span title={caption}>{caption}</span>
        <AssetFileActions key={asset.id} asset={asset} projectId={projectId} />
        {insert && <button onClick={insert}><AtSign size={15} />插入引用</button>}
      </div>
    </dialog>, document.body,
  );
}

export function Modal({ title, children, close, wide = false }) {
  const ref = useRef(null);
  const heading = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      className={"modal " + (wide ? "wide" : "")}
      aria-labelledby={heading}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <section>
        <header>
          <h2 id={heading}>{title}</h2>
          <button className="ico" aria-label="关闭" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </dialog>
  );
}
export function Guide() {
  return (
    <div className="guide">
      {[
        [
          LayoutDashboard,
          "创建项目",
          "点击「新建画布创作」，填入自己的剧本。展开「剧集设定」可填写画风、角色、世界、参考图和画幅。",
        ],
        [
          FileText,
          "写下剧本",
          "在剧本节点中每行写一个镜头，点击「拆成分镜」。分镜会保留与剧本的连线。",
        ],
        [
          Clapperboard,
          "为镜头配图",
          "打开「分镜表」，为每镜选择角色、场景和道具，按行生图或生视频。「本镜候选 → 采用此版」只替换这一镜。",
        ],
        [
          ListVideo,
          "调整顺序并导出",
          "进入「分镜台」设置每镜秒数、前后移动镜头，按需选择配乐。点「导出 MP4」后，从任务列表下载。继续连载时，在「剧集设定」里点「沿用这些设定创建下一集」。",
        ],
      ].map(([Icon, title, body], i) => (
        <article key={title}>
          <Icon size={22} />
          <div>
            <h3>
              {i + 1}. {title}
            </h3>
            <p>{body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
export function SampleCard({ item, onClick }) {
  return (
    <button className="sample-card" onClick={onClick}>
      <div className="poster">
        <img src={"/stills/" + item.cover + ".jpg"} alt="" />
        <span className="duration">
          <Play size={10} fill="currentColor" />
          {String(item.indexes.length * 3).padStart(2, "0")} 秒
        </span>
      </div>
      <div className="sample-line">
        <div>
          <strong>{item.name}</strong>
          <small>
            {item.subtitle} · {item.indexes.length} 个分镜
          </small>
        </div>
        <ArrowUpRight size={18} />
      </div>
    </button>
  );
}
