import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

function clock(seconds) {
  return Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
}

export function RestoreVideo({ restored, original, onReady, onRatio, controls, controlsHost, expanded, startTime }) {
  const master = useRef(null);
  const before = useRef(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  function align(exact = false) {
    const a = master.current, b = before.current;
    if (!a || !b || !b.readyState) return;
    const delta = a.currentTime - b.currentTime;
    if ((exact && Math.abs(delta) > 0.001) || (!b.seeking && Math.abs(delta) > 0.08))
      b.currentTime = a.currentTime;
    b.playbackRate = exact ? 1 : 1 + Math.max(-0.08, Math.min(0.08, delta));
  }
  function follow() {
    const a = master.current, b = before.current;
    if (!a || !b || a.paused || a.seeking || a.readyState < 3 || b.readyState < 2) return;
    align();
    if (b.paused) b.play().catch(() => {});
  }
  function pauseFollower() {
    before.current?.pause();
    align(true);
  }
  useEffect(() => {
    if (!controls) master.current?.pause();
  }, [controls]);

  const bar = controls && <div className="restore-video-controls nodrag nopan nowheel" role="group" aria-label="对比视频播放"
    onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <button type="button" aria-label={playing ? "暂停对比" : "播放对比"} disabled={!duration}
      onClick={() => master.current.paused ? master.current.play().catch(() => {}) : master.current.pause()}>
      {playing ? <Pause size={15} /> : <Play size={15} />}
    </button>
    <input aria-label="对比视频进度" type="range" min="0" max={duration || 0} step="any" value={time}
      disabled={!duration} onChange={e => {
        const next = Number(e.target.value);
        master.current.currentTime = next;
        align(true);
        setTime(next);
      }} />
    <span>{clock(time)} / {clock(duration)}</span>
    <button type="button" aria-label={muted ? "打开声音" : "静音"} onClick={() => setMuted(!muted)}>
      {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
    </button>
  </div>;
  return <>
    <video ref={master} data-restored-video={restored.id} src={restored.url} aria-label="修复后的视频"
      playsInline preload={controls ? "auto" : "metadata"} muted={muted}
      onLoadedMetadata={e => {
        const video = e.currentTarget;
        if (Number.isFinite(video.duration)) setDuration(video.duration);
        if (video.videoHeight) onRatio(video.videoWidth / video.videoHeight);
        if (startTime) video.currentTime = Math.min(startTime, video.duration);
      }}
      onPlaying={() => { setPlaying(true); follow(); }}
      onPause={() => { setPlaying(false); pauseFollower(); }}
      onWaiting={pauseFollower} onSeeking={pauseFollower}
      onSeeked={() => { align(true); follow(); }}
      onTimeUpdate={e => { setTime(e.currentTarget.currentTime); if (!e.currentTarget.paused) follow(); }} />
    <video ref={before} className="restore-original" src={original.url} aria-label="修复前的视频"
      playsInline muted preload={controls ? "auto" : "metadata"}
      onLoadedData={() => { align(true); onReady(true); follow(); }} onCanPlay={follow}
      onError={() => onReady(false)} />
    {expanded ? controlsHost && createPortal(bar, controlsHost) : bar}
  </>;
}
