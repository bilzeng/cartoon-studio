import { useEffect, useRef, useState } from "react";
import "./panorama-viewer.css";

// Cast a ray from each screen pixel into the equirectangular image. Yaw is
// only a horizontal offset in that image, so horizontal drags reuse the map.
function projection(width, height, pitch, zoom) {
  const longitude = new Float32Array(width * height);
  const latitude = new Float32Array(width * height);
  const distance = Math.max(width * 0.48, height * 0.78) * zoom;
  const radians = pitch * Math.PI / 180;
  const sin = Math.sin(radians), cos = Math.cos(radians);
  for (let y = 0; y < height; y++) {
    const down = (y + 0.5 - height / 2) / distance;
    const dy = down * cos - sin, dz = down * sin + cos;
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - width / 2) / distance;
      const i = y * width + x;
      longitude[i] = 0.5 + Math.atan2(dx, dz) / (2 * Math.PI);
      latitude[i] = 0.5 + Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) / Math.PI;
    }
  }
  return { longitude, latitude, width, height, pitch, zoom };
}

function drawFrame(source, map, frame, yaw) {
  const { width, height, data } = source;
  const offset = yaw * width / 360;
  for (let i = 0; i < map.longitude.length; i++) {
    let x = map.longitude[i] * width - 0.5 + offset;
    if (x < 0) x += width;
    if (x >= width) x -= width;
    const y = Math.max(0, Math.min(height - 1, map.latitude[i] * height - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0 + 1 === width ? 0 : x0 + 1;
    const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4;
    const nextRow = y0 + 1 < height ? width * 4 : 0;
    const fx = x - x0, fy = y - y0;
    for (let c = 0; c < 3; c++) {
      const top = data[a+c] + fx * (data[b+c] - data[a+c]);
      const bottom = data[a+nextRow+c] + fx * (data[b+nextRow+c] - data[a+nextRow+c]);
      frame.data[4*i+c] = top + fy * (bottom - top);
    }
    frame.data[4*i+3] = 255;
  }
}

async function loadSheet(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const sheet = document.createElement("canvas");
  sheet.width = Math.min(4096, image.naturalWidth);
  sheet.height = Math.min(2048, Math.max(1, Math.round(image.naturalHeight * sheet.width / image.naturalWidth)));
  const reader = sheet.getContext("2d", { willReadFrequently:true });
  reader.drawImage(image, 0, 0, sheet.width, sheet.height);
  return reader.getImageData(0, 0, sheet.width, sheet.height);
}

export function PanoramaViewer({ asset, original, zoom = 1, onCompareReady }) {
  const viewport = useRef(null);
  const canvas = useRef(null), beforeCanvas = useRef(null);
  const magnification = useRef(zoom);
  const view = useRef({ yaw:0, pitch:0 });
  const pointer = useRef(null);
  const dragged = useRef(false);
  const redraw = useRef(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    const el = viewport.current;
    const layers = [canvas.current, beforeCanvas.current].filter(Boolean).map(screen => ({
      screen, ctx: screen.getContext("2d", {alpha:false}), source:null, frame:null,
    }));
    setStatus("loading");
    onCompareReady?.(false);
    if (layers[1]) layers[1].screen.style.visibility = "hidden";
    let map, request = 0, active = true;
    function render() {
      request = 0;
      if (!layers[0].source || !el.clientWidth || !el.clientHeight) return;
      // Keep a sharp still when the node is enlarged on the canvas. During a
      // drag cap the pixel budget and redraw at full detail on release.
      const widthLimit = pointer.current ? 720 : 1280;
      const density = Math.max(window.devicePixelRatio || 1, 720 / el.clientWidth);
      const scale = Math.min(density, widthLimit / el.clientWidth, widthLimit / el.clientHeight);
      const width = Math.max(1, Math.round(el.clientWidth * scale));
      const height = Math.max(1, Math.round(el.clientHeight * scale));
      const { yaw, pitch } = view.current, zoom = magnification.current;
      if (!map || map.width !== width || map.height !== height || map.pitch !== pitch || map.zoom !== zoom)
        map = projection(width, height, pitch, zoom);
      for (const layer of layers) {
        if (!layer.source) continue;
        if (!layer.frame || layer.frame.width !== width || layer.frame.height !== height) {
          layer.screen.width = width;
          layer.screen.height = height;
          layer.frame = layer.ctx.createImageData(width, height);
        }
        drawFrame(layer.source, map, layer.frame, yaw);
        layer.ctx.putImageData(layer.frame, 0, 0);
      }
    }
    function schedule() {
      if (layers[0].source && !request) request = requestAnimationFrame(render);
    }
    redraw.current = schedule;
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      layers.forEach(async (layer, i) => {
        try {
          const source = await loadSheet(i === 0 ? asset.url : original.url);
          if (!active) return;
          layer.source = source;
          render();
          if (layers[0].source) setStatus("ready");
          if (layers[0].source && layers[1]?.source) {
            layers[1].screen.style.visibility = "visible";
            onCompareReady?.(true);
          }
        } catch { if (active && i === 0) setStatus("error"); }
      });
    });
    observer.observe(el);
    return () => { active = false; redraw.current = null; observer.disconnect(); resize.disconnect(); cancelAnimationFrame(request); };
  }, [asset.url, original?.url, onCompareReady]);

  useEffect(() => {
    magnification.current = zoom;
    redraw.current?.();
  }, [zoom]);

  function look(yaw, pitch) {
    view.current = { yaw:(yaw % 360 + 360) % 360, pitch:Math.max(-90, Math.min(90, pitch)) };
    redraw.current?.();
  }
  function start(e) {
    if (e.button !== 0 || !e.isPrimary) return;
    dragged.current = false;
    const width = e.currentTarget.getBoundingClientRect().width;
    pointer.current = { id:e.pointerId, x:e.clientX, y:e.clientY, ...view.current, degrees:96 / (Math.max(1,width)*zoom) };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) {
    const p = pointer.current;
    if (p?.id !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged.current = true;
    if (dragged.current) look(p.yaw - dx*p.degrees, p.pitch + dy*p.degrees);
  }
  function key(e) {
    const { yaw, pitch } = view.current;
    const step = e.shiftKey ? 30 : 10;
    switch (e.key) {
      case "ArrowLeft": look(yaw-step, pitch); break;
      case "ArrowRight": look(yaw+step, pitch); break;
      case "ArrowUp": look(yaw, pitch+step); break;
      case "ArrowDown": look(yaw, pitch-step); break;
      case "Home": look(0, 0); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
  return <div ref={viewport} className="panorama-viewer nodrag nopan" data-status={status} role="group" tabIndex={0}
    aria-label={asset.name + "，360° 全景，拖动或使用方向键环视"} onPointerDown={start} onPointerMove={move}
    onLostPointerCapture={() => { pointer.current = null; redraw.current?.(); }}
    onClick={e => { if (dragged.current) e.stopPropagation(); }} onDoubleClick={e => e.stopPropagation()} onKeyDown={key}>
    <canvas ref={canvas} aria-hidden="true" />
    {original && <canvas ref={beforeCanvas} className="panorama-before" aria-hidden="true" />}
    <span className="panorama-hint">{status === "error" ? "全景图片加载失败" : status === "ready" ? "360° · 拖动环视" : "加载全景…"}</span>
  </div>;
}
