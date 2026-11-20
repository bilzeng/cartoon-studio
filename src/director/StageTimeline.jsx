import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Camera, ChevronDown, ChevronLeft, ChevronRight, DiamondPlus, ListVideo, Maximize, Minus, Pause, PersonStanding, Play, Repeat2, Timer, Plus, Scissors, SquareDashedMousePointer, Trash2 } from "lucide-react";
import { endFrameOf, maxEndFrame, stageFps } from "../../shared/stage-animation";
import { markerId, stageTracks } from "../../shared/stage-markers";

const seconds = frame => Number((frame / stageFps).toFixed(2));
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const icons = {actor:PersonStanding,camera:Camera,prop:Box,cuts:Scissors};
function timecode(frame) {
  const s = Math.floor(frame/stageFps);
  return [Math.floor(s/60),s%60,frame%stageFps].map(n=>String(n).padStart(2,"0")).join(":");
}
function combined(base, additions) {
  return [...new Map([...base,...additions].map(m=>[markerId(m),m])).values()];
}

export function StageTimeline({ stage, track, frame, playing, loop, toggleLoop, autoKey, toggleAutoKey, locked, togglePlay, seek, select, addKey, markers, pick, editKeys, duration, close }) {
  const end = endFrameOf(stage);
  const rows = useMemo(()=>stageTracks(stage),[stage]);
  const active = rows.find(r=>r.id === track);
  const selected = useMemo(()=>new Set(markers.map(markerId)),[markers]);
  const [multi,setMulti] = useState(false), [zoom,setZoom] = useState(1), [lengthText,setLengthText] = useState(null);
  const [box,setBox] = useState(null), [offset,setOffset] = useState(0), [railWidth,setRailWidth] = useState(800);
  const panel = useRef(null), scroll = useRef(null), content = useRef(null), ruler = useRef(null);
  const gesture = useRef(null), anchor = useRef(null), prevZoom = useRef(zoom), panFrame = useRef(0);
  useLayoutEffect(()=>()=>cancelAnimationFrame(panFrame.current),[]);
  const before = active?.keys.findLast(k=>k.frame<frame), after = active?.keys.find(k=>k.frame>frame);
  const atHead = active?.keys.some(k=>k.frame === frame) ? [{track,frame}] : [];
  const targets = markers.length ? markers : atHead;
  const step = [1,2,3,6,12,24,48,120,240,480,720,1440].find(n=>n*railWidth/end >= 68) || end;
  const ticks = Array.from({length:Math.floor(end/step)+1},(_,i)=>i*step);
  useLayoutEffect(()=>{
    const observer = new ResizeObserver(()=>setRailWidth(ruler.current?.clientWidth || 800));
    observer.observe(ruler.current);
    return ()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    if (prevZoom.current === zoom) return;
    prevZoom.current = zoom;
    const wrapper = scroll.current;
    const labelWidth = ruler.current.offsetLeft;
    wrapper.scrollLeft = frame/end*ruler.current.clientWidth-(wrapper.clientWidth-labelWidth)/2;
  },[zoom,frame,end]);
  function allMarkers(items) {
    return items.flatMap(r=>r.keys.map(k=>({track:r.id,frame:k.frame})));
  }
  function scrub(f) { pick([]); anchor.current = null; seek(f); }
  function choose(marker,event) {
    const id = markerId(marker), toggle = event.metaKey || event.ctrlKey || multi;
    let next = [marker];
    if (event.shiftKey && anchor.current && rows.some(r=>r.id === anchor.current.track && r.keys.some(k=>k.frame === anchor.current.frame))) {
      const origin = anchor.current, left = Math.min(origin.frame,marker.frame), right = Math.max(origin.frame,marker.frame);
      const a = rows.findIndex(r=>r.id===origin.track), b = rows.findIndex(r=>r.id===marker.track);
      next = allMarkers(rows.slice(Math.min(a,b),Math.max(a,b)+1)).filter(k=>k.frame>=left && k.frame<=right);
      if (toggle) next = combined(markers,next);
    } else {
      anchor.current = marker;
      if (toggle) next = selected.has(id) ? markers.filter(k=>markerId(k)!==id) : [...markers,marker];
      else if (selected.has(id)) next = markers;
    }
    select(marker.track); seek(marker.frame); pick(next);
    return next;
  }
  function point(e) {
    const rect = content.current.getBoundingClientRect();
    return {x:e.clientX-rect.left,y:e.clientY-rect.top};
  }
  function frameAt(x) {
    const rect = ruler.current.getBoundingClientRect();
    return clamp(Math.round((x-rect.left)/rect.width*end),0,end);
  }
  function pointerDown(e) {
    const lane = e.target.closest(".ds-rail");
    if (e.button !== 0 || !lane || gesture.current) return;
    const key = e.target.closest("[data-frame]"), start = point(e);
    const additive = e.metaKey || e.ctrlKey || e.shiftKey || multi;
    const g = {id:e.pointerId,start,track:lane.dataset.track,additive,moved:false,offset:0};
    if (key) {
      g.marker = {track:g.track,frame:Number(key.dataset.frame)};
      g.selection = choose(g.marker,e);
    } else {
      g.selection = additive ? markers : [];
      select(g.track);
    }
    gesture.current = g;
    panel.current.focus({preventScroll:true});
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
  }
  function updateDrag(g,e) {
    const p = point(e);
    if (!g.moved && Math.hypot(p.x-g.start.x,p.y-g.start.y)<4) return;
    g.moved = true;
    if (g.marker) {
      if (!g.selection.some(m=>m.track===g.marker.track && m.frame===g.marker.frame)) return;
      const start = g.selection.reduce((n,k)=>Math.min(n,k.frame),end);
      const last = g.selection.reduce((n,k)=>Math.max(n,k.frame),0);
      g.offset = clamp(Math.round((p.x-g.start.x)/ruler.current.clientWidth*end),-start,end-last);
      setOffset(g.offset); return;
    }
    const rect = {left:Math.min(p.x,g.start.x),top:Math.min(p.y,g.start.y),width:Math.abs(p.x-g.start.x),height:Math.abs(p.y-g.start.y)};
    setBox(rect);
    const origin = content.current.getBoundingClientRect();
    const left = rect.left+origin.left, right = left+rect.width, top = rect.top+origin.top, bottom = top+rect.height;
    const hit = [];
    for (const lane of content.current.querySelectorAll(".ds-rail")) {
      const bounds = lane.getBoundingClientRect(), cy = bounds.top+bounds.height/2;
      if (cy+5<top || cy-5>bottom) continue;
      const row = rows.find(r=>r.id===lane.dataset.track);
      for (const {frame} of row.keys) {
        const cx = bounds.left+frame/end*bounds.width;
        if (cx+5>=left && cx-5<=right) hit.push({track:row.id,frame});
      }
    }
    pick(combined(g.selection,hit));
  }
  function autoScroll() {
    panFrame.current = 0;
    const g = gesture.current, viewport = scroll.current;
    if (!g?.moved || !viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const speed = (value,min,max) => value<min+22 ? -Math.min(16,(min+22-value)/2) : value>max-22 ? Math.min(16,(value-max+22)/2) : 0;
    const dx = speed(g.pointer.clientX,bounds.left+ruler.current.offsetLeft,bounds.right);
    const dy = g.marker ? 0 : speed(g.pointer.clientY,bounds.top+26,bounds.bottom);
    const x=viewport.scrollLeft, y=viewport.scrollTop;
    viewport.scrollBy(dx,dy);
    if (x!==viewport.scrollLeft || y!==viewport.scrollTop) {
      updateDrag(g,g.pointer);
      panFrame.current = requestAnimationFrame(autoScroll);
    }
  }
  function pointerMove(e) {
    const g = gesture.current;
    if (!g || g.id!==e.pointerId) return;
    g.pointer = {clientX:e.clientX,clientY:e.clientY};
    updateDrag(g,g.pointer);
    if (g.moved && !panFrame.current) panFrame.current = requestAnimationFrame(autoScroll);
  }
  function finish(e,cancel=false) {
    const g = gesture.current;
    if (!g || g.id!==e.pointerId) return;
    gesture.current=null; cancelAnimationFrame(panFrame.current); panFrame.current=0; setBox(null); setOffset(0);
    if (cancel) return;
    if (g.marker && g.offset) editKeys(g.selection,g.offset,g.marker.frame);
    else if (!g.moved && g.marker && !g.additive) pick([g.marker]);
    else if (!g.moved && !g.marker) {
      if (!g.additive) { pick([]); anchor.current=null; }
      seek(frameAt(e.clientX));
    }
  }
  function removeKeys() {
    if (!targets.length || playing) return;
    panel.current.focus({preventScroll:true}); editKeys(targets,null,frame);
  }
  function keyDown(e) {
    if (e.isComposing || e.target.closest('input,textarea,[contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase()==="a") { e.preventDefault(); pick(allMarkers(rows)); }
    else if ((e.key==="Delete" || e.key==="Backspace") && !mod) { e.preventDefault(); if (markers.length && !e.repeat) removeKeys(); }
    else if (e.key==="Escape" && (markers.length || multi)) { e.preventDefault(); pick([]); setMulti(false); anchor.current=null; }
    else if (e.key===" " && !e.target.closest("button")) { e.preventDefault(); togglePlay(); }
    else if (["ArrowLeft","ArrowRight"].includes(e.key) && markers.length && !mod && !playing) {
      e.preventDefault(); editKeys(markers,e.key==="ArrowLeft" ? -1 : 1,frame);
    }
  }
  return <section className="ds-timeline" ref={panel} tabIndex={-1} aria-label="动画时间轴" onKeyDown={keyDown}>
    <header>
      <h3><ListVideo size={16}/>时间轴</h3>
      <div className="ds-transport">
        <button aria-label="上一个关键帧" title="上一个关键帧" disabled={!before} onClick={()=>scrub(before.frame)}><ChevronLeft size={16}/></button>
        <button className="ds-play" aria-label={playing ? "暂停" : "播放"} onClick={togglePlay}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
        <button aria-label="下一个关键帧" title="下一个关键帧" disabled={!after} onClick={()=>scrub(after.frame)}><ChevronRight size={16}/></button>
        <button aria-label="循环播放" aria-pressed={loop} title="循环播放" onClick={toggleLoop}><Repeat2 size={15}/></button>
        <output aria-label="当前时间" title="分 · 秒 · 帧">{timecode(frame)}</output>
      </div>
      <span className="ds-time-divider"/>
      <div className="ds-key-tools">
        <button aria-label="自动关键帧" aria-pressed={autoKey} title="自动关键帧：调整对象时在播放头位置记录" onClick={toggleAutoKey}><Timer size={15}/>自动帧</button>
        <button disabled={!active || locked || playing} onClick={addKey}>{track==="cuts" ? <Scissors size={14}/> : <DiamondPlus size={15}/>}
          {track==="cuts" ? "记录切镜" : "记录关键帧"}</button>
        <button aria-pressed={multi} onClick={()=>setMulti(v=>!v)} title="多选关键帧，可直接点选或拖框"><SquareDashedMousePointer size={15}/>多选</button>
        <button className="ds-delete-keys" disabled={!targets.length || playing} onClick={removeKeys}
          aria-label={targets.length>1 ? "删除选中的 "+targets.length+" 个关键帧" : "删除当前关键帧"} title="删除选中关键帧（Delete / Backspace）"><Trash2 size={14}/>
          {markers.length ? "删除 "+markers.length+" 帧" : "删除"}</button>
      </div>
      <div className="ds-time-options">
        <div className="ds-zoom">
          <button aria-label="缩小时间轴" disabled={zoom===1} onClick={()=>setZoom(zoom/2)}><Minus size={13}/></button>
          <button title="适应时间轴" aria-label="适应时间轴" onClick={()=>setZoom(1)}><Maximize size={13}/></button>
          <button aria-label="放大时间轴" disabled={zoom>=32} onClick={()=>setZoom(zoom*2)}><Plus size={13}/></button>
        </div>
        <label className="ds-length">时长<input aria-label="动画时长（秒）" type="number" min={1/stageFps} max={maxEndFrame/stageFps} step="any" value={lengthText ?? seconds(end)}
          onChange={e=>setLengthText(e.target.value)} onBlur={()=>{if(lengthText?.trim()) duration(Math.round(Number(lengthText)*stageFps)); setLengthText(null);}}
          onKeyDown={e=>{if(e.key==="Enter") e.currentTarget.blur();}}/>秒</label>
        <button aria-label="收起时间轴" title="收起时间轴" onClick={close}><ChevronDown size={16}/></button>
      </div>
    </header>
    <div className="ds-tracks" ref={scroll}>
      <div className="ds-track-content" ref={content} style={{width:zoom*100+"%"}}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finish} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e,true)}>
        <div className="ds-track ds-timeruler"><div className="ds-track-heading">轨道 <span>{stageFps} fps</span></div>
          <div className="ds-scrub" ref={ruler} style={{"--tick":step/end*100+"%"}}>
            {ticks.map(t=><span className="ds-tick" key={t} style={{left:t/end*100+"%"}} data-last={t===end || undefined}>{seconds(t)}s</span>)}
            <input aria-label="时间轴播放头" aria-valuetext={seconds(frame)+" 秒"} type="range" min="0" max={end} step="1" value={frame} onChange={e=>scrub(Number(e.target.value))}/>
            <i className="ds-playhead-cap" style={{left:frame/end*100+"%"}}/>
          </div></div>
        {rows.map(row=>{
          const Icon = icons[row.type], keys = row.keys;
          return <div className="ds-track" key={row.id} data-type={row.type} data-active={track===row.id || undefined}>
            <div className="ds-track-label"><button className="ds-track-name" title={row.name} onClick={()=>{select(row.id); pick([]); anchor.current=null;}}><Icon size={14}/>
              <span>{row.name}</span></button>
              {keys.length>0 && <button className="ds-track-count" aria-label={"选中"+row.name+"的所有关键帧"} title={"选中本轨 "+keys.length+" 个关键帧"}
                onClick={e=>{select(row.id); const list=allMarkers([row]); pick(multi || e.ctrlKey || e.metaKey ? combined(markers,list) : list); anchor.current=list[0];}}>
                {keys.length} 帧</button>}</div>
            <div className="ds-rail" data-track={row.id} style={{"--tick":step/end*100+"%"}}>
              {keys.length>1 && <span className="ds-clip-span" style={{left:keys[0].frame/end*100+"%",width:(keys.at(-1).frame-keys[0].frame)/end*100+"%"}}/>}
              {keys.map(k=>{
                const marker={track:row.id,frame:k.frame}, chosen=selected.has(markerId(marker));
                return <button key={k.frame} data-frame={k.frame} aria-pressed={chosen} className="ds-diamond"
                  style={{left:(k.frame+(chosen ? offset : 0))/end*100+"%"}} aria-label={row.name+" 第 "+k.frame+" 帧"}
                  title={row.name+" · "+timecode(k.frame)} onClick={e=>{if(e.detail===0) choose(marker,e);}}/>;
              })}
              <i className="ds-cursor" style={{left:frame/end*100+"%"}}/>
            </div></div>;
        })}
        {box && <div className="ds-marquee" aria-hidden="true" style={box}/>}
      </div>
    </div>
  </section>;
}
