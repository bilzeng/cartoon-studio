import React, { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RestoreVideo } from "./RestoreVideo";

import "./restore-comparison.css";

export function restoreOriginal(asset, assets) {
  return asset?.restoreSourceId && assets.find(item => item.id === asset.restoreSourceId && item.kind === asset.kind);
}

export function RestoreComparison({ original, restored, expanded = false, actualSize = false, controls = expanded, controlsHost, startTime }) {
  const video = restored.kind === "video";
  const [split, setSplit] = useState(expanded || video ? 50 : 72);
  const [ratio, setRatio] = useState(16 / 9);
  const [ready, setReady] = useState(false);
  const frame = useRef(null);
  const drag = useRef(null);
  const wholeImage = expanded && !actualSize;
  const adjust = (n) => setSplit(Math.max(0, Math.min(100, n)));
  function fractionAt(x) {
    const bounds = frame.current.getBoundingClientRect();
    return (x - bounds.left) / bounds.width * 100;
  }

  function start(e) {
    if (!e.isPrimary || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = fractionAt(e.clientX);
    drag.current = { id: e.pointerId, offset: wholeImage ? 0 : split - at };
    if (wholeImage) adjust(at);
  }
  function move(e) {
    const start = drag.current;
    if (start?.id !== e.pointerId) return;
    const at = fractionAt(e.clientX);
    adjust(at <= 0 || at >= 100 ? at : at + start.offset);
  }
  function key(e) {
    const step = e.shiftKey ? 10 : 1;
    const values = { ArrowLeft: split - step, ArrowRight: split + step, ArrowDown: split - step,
      ArrowUp: split + step, Home: 0, End: 100 };
    if (!Object.hasOwn(values, e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    adjust(values[e.key]);
  }

  return (
    <div ref={frame} className="restore-comparison" data-expanded={expanded || undefined} data-scrub={wholeImage || undefined}
      data-video={video || undefined} data-controls={video && controls || undefined} data-ready={ready || undefined}
      style={{ "--split": split + "%", "--video-ratio": ratio }}>
      {video ? <RestoreVideo {...{ original, restored, controls, controlsHost, expanded, startTime }}
        onReady={setReady} onRatio={setRatio} /> : <>
      <img src={restored.url} alt={restored.name} draggable={false} />
      <img className="restore-original" src={original.url} alt="修复前的原图" draggable={false}
        style={{ visibility: ready ? "visible" : "hidden" }}
        onLoad={() => setReady(true)} onError={() => setReady(false)} />
      </>}
      {ready && <>
        {split >= 18 && <span className="restore-caption after" aria-hidden="true">修复后</span>}
        {split <= 82 && <span className="restore-caption before" aria-hidden="true">修复前</span>}
        <span className="restore-divider" aria-hidden="true" />
        <div role="slider" tabIndex={0} className="restore-handle nodrag nopan"
          aria-label="修复前后对比" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(split)} aria-valuetext={"修复后画面占 " + Math.round(split) + "%"}
          title="向左拖动查看修复前，向右拖动查看修复后"
          onPointerDown={start} onPointerMove={move}
          onLostPointerCapture={() => { drag.current = null; }}
          onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onKeyDown={key}>
          <span className="restore-grip" aria-hidden="true"><ChevronLeft /><ChevronRight /></span>
        </div>
      </>}
    </div>
  );
}
