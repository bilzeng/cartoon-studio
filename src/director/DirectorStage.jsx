import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Aperture, ArrowLeft, Undo2, Redo2, Box, Camera, Check, Crosshair, ImagePlus, Layers, Move, Orbit, PersonStanding, Plus, Footprints, Film, RotateCcw, RotateCw, ScanEye, ListVideo, Route, SlidersHorizontal, Trash2, Video, X } from "lucide-react";
import { stageFrames, stageObject, stagePoses, stageShapes } from "../../shared/director-stage";
import { upstreamNodes } from "../../shared/canvasGroups";
import { Select } from "../Select";
import { uploadAsset } from "../client";
import { StageTimeline } from "./StageTimeline";
import { addCameraMove } from "../../shared/stage-camera";
import { propCatalog } from "../../shared/stage-props";
import { StageExport } from "./StageExport";
import { StageModels } from "./StageModels";
import { CameraMotion } from "./CameraMotion";
import { StageVision } from "./StageVision";
import { canvasStageImages, stageIsUntouched, applyStagePlan } from "../../shared/stage-references";
import { cutCamera, endFrameOf, keyObject, maxEndFrame, sampleStage, stageFps, walkTo } from "../../shared/stage-animation";
import { editMarkers } from "../../shared/stage-markers";
import { recordStage, replayStage, stageHistory } from "./stage-history";
import { createViewport } from "./viewport";
import "./director.css";

function NumberField({ label, value, min, max, step, change, prefix }) {
  const shown = String(Number(value.toFixed(3)));
  const [text, setText] = useState(null);
  function commit() {
    if (text == null) return;
    setText(null);
    const numeric = Number(text);
    if (!text.trim() || !Number.isFinite(numeric) || text === shown) return;
    const next = Math.min(max, Math.max(min, numeric));
    if (next !== value) change(next);
  }
  return <label className="ds-number"><span>{prefix}</span><input aria-label={label} type="number" min={min} max={max} step={step}
    value={text ?? shown} onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>;
}
function Axes({ field, label, item, apply }) {
  const limit = field === "rotation" ? 360 : 100;
  return <fieldset><legend>{label}</legend><div className="ds-axes">{["X","Y","Z"].map((axis, i) =>
    <NumberField key={axis} label={label + " " + axis} prefix={axis} min={field === "size" ? 0.02 : -limit} max={limit}
      step={field === "rotation" ? 5 : 0.1} value={item[field][i]}
      change={v => apply({ [field]: item[field].map((x,j) => j === i ? v : x) })} />)}</div></fieldset>;
}
function Tool({ icon: Icon, label, active, ...props }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} {...props}><Icon size={16} /></button>;
}
export default function DirectorStage({ node, board, assets, editStage:writeStage, captureFrame, captureVideo, refresh, close, status, flush }) {
  const base = node.data.stage;
  const [timeline,setTimeline] = useState(false), [vision,setVision] = useState(false);
  const [frame,setFrame] = useState(0), [playing,setPlaying] = useState(false), [cutTrack,setCutTrack] = useState(false);
  const [library,setLibrary] = useState(false);
  const [exportOpen,setExportOpen] = useState(false);
  const [walkMode,setWalkMode] = useState(false), [speed,setSpeed] = useState("1.35");
  const walkStart = useRef(0), previewEnd = useRef(null);
  const [lastMove,setLastMove] = useState(null);
  const frameNewRail = useRef(false);
  const frameRef = useRef(0), end = endFrameOf(base);
  const stage = useMemo(() => timeline ? sampleStage(base,frame) : base,[base,frame,timeline]);
  const images = useMemo(() => canvasStageImages(board,node.id,assets),[board,node.id,assets]);
  const untouched = useMemo(() => stageIsUntouched(base) && !node.data.assetId,[base,node.data.assetId]);
  function seek(next) {
    setPlaying(false); previewEnd.current = null; frameRef.current = next; setFrame(next);
  }
  function toggleTimeline() {
    setWalkMode(false); setMarkers([]); seek(0); setTimeline(v => !v); setCutTrack(false);
  }
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(), from = frameRef.current;
    const until = Math.min(end,previewEnd.current ?? end);
    let raf;
    function tick(now) {
      const next = Math.min(until,from + Math.floor((now-start)*stageFps/1000));
      if (next !== frameRef.current) { frameRef.current = next; setFrame(next); }
      if (next < until) raf = requestAnimationFrame(tick);
      else { previewEnd.current = null; setPlaying(false); }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  },[playing,end]);
  const [selected, setSelected] = useState(stage.objects.find(o => o.type === "actor")?.id || stage.cameraId);
  const [view, setView] = useState("director"), [tool, setTool] = useState("translate");
  const [panel, setPanel] = useState(""), [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const dialog = useRef(null), host = useRef(null), viewport = useRef(null), upload = useRef(null), locked = useRef(false);
  const actions = useRef(), nameEdit = useRef(null);
  const [markers,setMarkers] = useState([]);
  const history = stageHistory(base);
  function context() { return {frame:frameRef.current,selected,cutTrack,markers,timeline}; }
  function editStage(change,label="场景编辑",group) {
    const cursor = context();
    writeStage(current=>recordStage(current,change(current),cursor,label,group));
  }
  function restore(redo) {
    if (busy || locked.current) return;
    const cursor = context();
    let entry;
    writeStage(current=>{
      entry = replayStage(current,cursor,redo);
      return entry?.stage || current;
    });
    if (!entry) return;
    const restored = entry.context;
    if (restored.timeline) setTimeline(true);
    setWalkMode(false); setLastMove(null); setError("");
    setSelected(entry.stage.objects.some(o=>o.id===restored.selected) ? restored.selected : entry.stage.cameraId);
    setCutTrack(restored.cutTrack); setMarkers(restored.markers);
    seek(Math.min(restored.frame,endFrameOf(entry.stage)));
    setFeedback((redo ? "已重做" : "已撤销")+entry.label);
  }
  function shortcut(e) {
    e.stopPropagation();
    if (e.defaultPrevented || e.isComposing || e.target.closest("dialog")!==dialog.current ||
        e.target.closest('input:not([type="range"]):not([type="color"]),textarea,select,[contenteditable="true"],[role="listbox"],[role="combobox"]')) return;
    const key=e.key.toLowerCase(), mod=e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (key==="z" || key==="y")) {
      e.preventDefault();
      const redo = key==="y" || e.shiftKey;
      if ((redo ? history.future : history.past).length) restore(redo);
    } else if (timeline && markers.length && !playing && !e.repeat && (key==="delete" || key==="backspace")) {
      e.preventDefault(); changeKeys(markers,null,frame);
    }
  }
  function patch(id, fields) {
    setPlaying(false);
    if (timeline && Object.keys(fields).some(k => ["position","rotation","pose","scale","fov"].includes(k))) {
      editStage(s => keyObject(s,id,frameRef.current,fields),"调整关键帧");
    } else editStage(s => ({ ...s, objects: s.objects.map(o => o.id === id ? { ...o, ...fields } : o) }),
      fields.name === undefined ? "对象调整" : "重命名",fields.name === undefined ? null : nameEdit.current);
  }
  function choose(id) {
    setWalkMode(false); setMarkers([]); setSelected(id); setCutTrack(false);
    const next = stage.objects.find(o => o.id === id);
    if (!timeline && next?.type === "camera" && next.id !== stage.cameraId) editStage(s => ({ ...s, cameraId: id }));
  }
  function selectTrack(id) {
    setWalkMode(false); setPlaying(false); setCutTrack(id === "cuts");
    if (id !== "cuts") setSelected(id);
  }
  function changeKeys(keys,offset,from) {
    if (!keys.length || offset === 0) return;
    try {
      editStage(s=>editMarkers(s,keys,offset,endFrameOf(s)),offset===null ? "删除关键帧" : "移动关键帧");
      setMarkers(offset===null ? [] : keys.map(k=>({...k,frame:k.frame+offset})));
      seek(Math.min(end,Math.max(0,from+(offset || 0))));
      setFeedback(offset===null ? "已删除 "+keys.length+" 个关键帧" : "");
      setError("");
    } catch (e) { setError(e.message); }
  }
  function duration(value) {
    const last = Math.max(1,base.animation?.cuts.at(-1)?.frame || 0,...base.objects.map(o => o.keys?.at(-1)?.frame || 0));
    if (!Number.isInteger(value) || value < last || value > maxEndFrame) {
      setError("时长需覆盖所有关键帧，最长 120 秒"); return;
    }
    seek(Math.min(frame,value));
    editStage(s => ({...s,animation:{cuts:[],...s.animation,endFrame:value}}));
  }
  function apply(draft) {
    editStage(s => applyStagePlan(s,draft,untouched));
    setMarkers([]); seek(0); setSelected(draft.objects.find(o => o.type === "actor")?.id || draft.cameraId);
    setCutTrack(false); setView(untouched ? "camera" : "director"); setVision(false); setPanel(""); setFeedback("搭景草案已应用");
  }
  function openWalk() {
    const actor = base.objects.find(o => o.id === selected && o.type === "actor") || base.objects.find(o => o.type === "actor");
    if (!actor) { setError("请先添加角色"); return; }
    setSelected(actor.id); setPlaying(false); setCutTrack(false); setTimeline(true); setMarkers([]);
    setPanel(""); setView("director"); setWalkMode(true); walkStart.current = frameRef.current;
    setFeedback(""); setError("");
  }
  function placeStep(point) {
    try {
      const plan = walkTo(base,selected,frameRef.current,point,Number(speed));
      editStage(() => plan.stage,"角色走位"); seek(plan.end); setError("");
    } catch (e) { setError(e.message); }
  }
  function previewWalk() {
    setWalkMode(false); seek(walkStart.current); previewEnd.current = frame; setPlaying(true);
  }
  actions.current = { patch, choose, seek,placeStep };
  useLayoutEffect(() => {
    const el = dialog.current;
    el.showModal();
    return () => el.close();
  }, []);
  useEffect(() => {
    try {
      viewport.current = createViewport(host.current, {
        select: id => actions.current.choose(id),
        transform: (id, change) => actions.current.patch(id, change),
        walkPoint: point => actions.current.placeStep(point),
        selectRailKey: (id, f) => { actions.current.choose(id); actions.current.seek(f); setMarkers([{track:id,frame:f}]); },
        report: setError,
      });
      setReady(true);
    } catch {
      setError("无法启动三维视窗。请在浏览器设置中开启图形加速，再重新打开导演台。");
    }
    return () => { viewport.current?.dispose(); viewport.current = null; };
  }, []);
  const background = assets.find(a => a.id === stage.backgroundId);
  const sources = useMemo(() => {
    const byId = new Map(assets.map(a => [a.id,a]));
    return [...new Set([...upstreamNodes(board,node.id).map(n => n.data.assetId),...(base.referenceIds || []),base.backgroundId])]
      .map(id => byId.get(id)).filter(a => a?.kind === "image");
  },[board,node.id,assets,base]);
  useEffect(() => {
    viewport.current?.update(stage, selected, view, playing ? "orbit" : walkMode ? "walk" : tool, background?.url);
  }, [ready, stage, selected, view, tool, playing, walkMode, background?.url]);
  const item = stage.objects.find(o => o.id === selected);
  const cameras = stage.objects.filter(o => o.type === "camera");
  const railCamera = base.objects.find(o => o.id === (item?.type === "camera" ? selected : stage.cameraId));
  const trackObject = base.objects.find(o => o.id === selected && o.type === "actor") || railCamera;
  useEffect(() => {
    viewport.current?.setRail(timeline ? trackObject : null);
    if (frameNewRail.current) { viewport.current?.frameRail(); frameNewRail.current = false; }
  }, [ready, timeline, trackObject]);
  function openMotion() {
    setWalkMode(false); setPlaying(false); setTimeline(true); setCutTrack(false); setSelected(railCamera.id); setMarkers([]);
    setView("director"); setPanel("inspector");
  }
  function applyMove(options) {
    try {
      editStage(s => {
        const moved = addCameraMove(s,selected,{...options,start:frame});
        return sampleStage(moved,frame).cameraId === selected ? moved : cutCamera(moved,selected,frame);
      },"添加运镜");
      setLastMove({id:selected,start:frame,end:frame+options.frames});
      frameNewRail.current = true;
      setTimeline(true); seek(frame); setView("director"); setPanel(""); setError(""); setFeedback("运镜已加入轨道");
    } catch (e) { setError(e.message); }
  }
  function openLibrary() { setPlaying(false); setLibrary(true); }
  function add(type, shape) {
    setPlaying(false); setWalkMode(false); setCutTrack(false);
    if (stage.objects.length >= 64) { setError("场景最多支持 64 个对象"); return; }
    const created = stageObject(type, stage.objects.filter(o => o.type === type).length);
    if (type === "prop" && shape) {
      const model = propCatalog[shape];
      Object.assign(created,{name:model.name,shape,size:[...model.size],color:model.color});
    }
    const names = new Set(stage.objects.map(o => o.name));
    const stem = type === "prop" && shape ? propCatalog[shape].name : ({actor:"角色",camera:"机位",prop:"布景"}[type]);
    let index = 1;
    while (names.has(created.name)) created.name = stem + " " + ++index;
    editStage(s => {
      const next = { ...s, objects: [...s.objects, created] };
      if (type !== "camera") return next;
      return timeline ? cutCamera(next, created.id, frame) : { ...next, cameraId: created.id };
    });
    setMarkers([]); setSelected(created.id); setView("director"); setFeedback(""); setLibrary(false);
  }
  function remove() {
    if (!item || (item.type === "camera" && cameras.length <= 1)) return;
    const remaining = base.objects.filter(o => o.id !== item.id);
    const nextCamera = item.id === base.cameraId ? remaining.find(o => o.type === "camera").id : base.cameraId;
    setPlaying(false); setWalkMode(false); setCutTrack(false);
    editStage(s => ({ ...s, objects: remaining, cameraId: nextCamera,
      ...(s.animation && { animation:{...s.animation,cuts:s.animation.cuts.filter(k => k.cameraId !== item.id)} }) }));
    setMarkers([]); setSelected(nextCamera);
  }
  async function take() {
    setPlaying(false);
    if (locked.current || !viewport.current) return;
    locked.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const current = timeline ? sampleStage(base, frameRef.current) : base;
      const shot = current.objects.find(o => o.id === current.cameraId);
      viewport.current.update(current, selected, view, tool, background?.url);
      const blob = await viewport.current.capture();
      await captureFrame(node.id, shot.name || "机位", blob);
      setFeedback("已添加到画布");
    } catch (e) { setError(e.message); }
    finally { locked.current = false; setBusy(false); }
  }
  async function backdrop(e) {
    const file = e.target.files[0]; e.target.value = "";
    if (!file || locked.current) return;
    locked.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const asset = await uploadAsset(file, board.id);
      if (asset.kind !== "image") throw Error("请选择全景图片");
      await refresh(); editStage(s => ({ ...s, backgroundId: asset.id, backgroundMode: "panorama" }));
    } catch (err) { setError(err.message); }
    finally { locked.current = false; setBusy(false); }
  }
  const ratioSelect = <Select value={stage.ratio} aria-label="取景画幅" onValueChange={ratio => editStage(s => ({ ...s, ratio }))}>
    {Object.keys(stageFrames).map(r => <option key={r}>{r}</option>)}</Select>;
  return createPortal(<dialog ref={dialog} aria-label="3D 导演台" className="director-stage" data-timeline={timeline || undefined} onCancel={e => { if (e.target === e.currentTarget) { e.preventDefault(); if (markers.length) setMarkers([]); else if (walkMode) setWalkMode(false); else if (!locked.current) close(); } }}
    onKeyDown={shortcut} onClick={e => e.stopPropagation()}>
    <header className="ds-header">
      <button className="ds-return" onClick={close} disabled={busy}><ArrowLeft size={16} /><span>返回画布</span></button>
      <i /><Box size={17} /><h2>3D 导演台</h2><small>{node.data.title}</small>
      <div className="ds-history" role="group" aria-label="编辑历史">
        <button aria-label="撤销" title={"撤销"+(history.past.at(-1)?.label || "")+"（⌘/Ctrl Z）"} disabled={!history.past.length || busy} onClick={()=>restore(false)}><Undo2 size={15}/><span>撤销</span></button>
        <button aria-label="重做" title={"重做"+(history.future.at(-1)?.label || "")+"（⌘/Ctrl Shift Z）"} disabled={!history.future.length || busy} onClick={()=>restore(true)}><Redo2 size={15}/><span>重做</span></button>
      </div>
      <button className="ds-ai-open" onClick={() => { setPlaying(false); setVision(true); }}><ScanEye size={16}/>AI 识图搭景</button>
      <span className="ds-status" role="status">{status === "已保存" && <Check size={13} />}{status}</span>
    </header>
    <div className="ds-layout" data-panel={panel}>
      <aside className="ds-scene">
        <header><h3><Layers size={15} />场景对象</h3><span>{stage.objects.length}</span>
          <Tool label="收起对象列表" icon={X} className="ds-mobile" onClick={() => setPanel("")} /></header>
        <div className="ds-object-list">{["actor", "prop", "camera"].map(type => <section key={type}>
          <div className="ds-section-title">{{actor:"角色",prop:"布景",camera:"机位"}[type]}
            <Tool label={{actor:"添加角色",prop:"添加布景",camera:"添加机位"}[type]} icon={Plus} onClick={() => type === "prop" ? openLibrary() : add(type)} /></div>
          {stage.objects.filter(o => o.type === type).map(o => <button key={o.id} aria-pressed={o.id === selected} className="ds-object"
            onClick={() => choose(o.id)}>{type === "actor" ? <PersonStanding size={16} style={{ color: o.color }} /> : type === "prop" ? <Box size={15}/> : <Video size={15} />}
            <span>{o.name || (type === "actor" ? "未命名角色" : "未命名机位")}</span>{o.id === stage.cameraId && <Aperture size={12} aria-label="当前取景机位" />}</button>)}
        </section>)}</div>
        <div className="ds-background"><button className="ds-model-open" onClick={openLibrary}><Box size={15}/>布景模型库</button><h3>环境</h3>
          {sources.length > 0 && <Select aria-label="场景背景" value={stage.backgroundId || ""} onValueChange={id =>
            editStage(s => ({ ...s, backgroundId: id, backgroundMode: "flat" }))}>
            <option value="">棚拍背景</option>
            {sources.map(asset => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</Select>}
          <button onClick={() => upload.current.click()} disabled={busy}><ImagePlus size={15} />
          <span>导入全景背景</span></button>
          <input hidden ref={upload} type="file" accept="image/jpeg,image/png,image/webp" onChange={backdrop} /></div>
      </aside>
      <main className="ds-workspace" data-walking={walkMode || undefined}><div ref={host} className="ds-viewport" />
        <div className="ds-views"><Tool label="场景对象" icon={Layers} className="ds-mobile" onClick={() => setPanel(panel === "scene" ? "" : "scene")} />
          <div role="group" aria-label="视角"><button aria-pressed={view === "director"} onClick={() => setView("director")}><Orbit size={15} />导演视角</button>
            <button aria-pressed={view === "camera"} onClick={() => { setWalkMode(false); setView("camera"); }}><Video size={15} />机位视角</button></div>
          <Tool label="对象属性" icon={SlidersHorizontal} className="ds-mobile" onClick={() => setPanel(panel === "inspector" ? "" : "inspector")} /></div>
        {walkMode && <div className="ds-walk-bar"><Footprints size={16}/><span>点地面设置下一落点</span>
          <Select aria-label="走位步速" value={speed} onValueChange={setSpeed}><option value="0.8">慢走</option><option value="1.35">正常步速</option><option value="2">快走</option></Select>
          <button disabled={frame <= walkStart.current} onClick={previewWalk}>预览走位</button>
          <button title="结束布点" aria-label="结束布点" onClick={() => setWalkMode(false)}><X size={15}/></button></div>}
        {view === "director" && !walkMode && <div className="ds-tools" role="group" aria-label="场景工具">{[[Move,"移动对象","translate"],[RotateCw,"旋转对象","rotate"],[Orbit,"环绕观察","orbit"]].map(([icon,label,id]) =>
          <Tool key={id} icon={icon} label={label} active={tool === id} onClick={() => setTool(id)} />)}
          {timeline && trackObject?.keys?.length > 0 && <Tool label={trackObject.type === "camera" ? "查看整条镜头轨道" : "查看整条走位路线"} icon={Route} onClick={() => viewport.current?.frameRail()} />}
          <i /><Tool label="重置导演视角" icon={RotateCcw} onClick={() => viewport.current?.reset()} /></div>}
        {error && <div className="ds-error" role="alert">{error}<button aria-label="关闭提示" onClick={() => setError("")}><X size={14}/></button></div>}
      </main>
      <aside className="ds-inspector">
        <header><h3><SlidersHorizontal size={15} />对象属性</h3><Tool label="收起属性" icon={X} className="ds-mobile" onClick={() => setPanel("")} /></header>
        {item && <div className="ds-properties" key={item.id}>
          <label>名称<input aria-label="对象名称" value={item.name} maxLength={80} onFocus={()=>{nameEdit.current=Symbol();}} onBlur={()=>{nameEdit.current=null;}} onChange={e => patch(item.id, { name: e.target.value })} /></label>
          {item.type === "camera" && <CameraMotion stage={base} frame={frame} apply={applyMove}
              lastMove={lastMove?.id === selected && item.keys?.some(k => k.frame === lastMove.end) ? lastMove : null}
              preview={() => { seek(lastMove.start); previewEnd.current = lastMove.end; setView("camera"); setPlaying(true); }}
              append={() => { seek(lastMove.end); setView("director"); }}/>}
          <Axes item={item} field="position" label="位置" apply={f => patch(item.id, f)} />
          <Axes item={item} field="rotation" label="旋转角度" apply={f => patch(item.id, f)} />
          {item.type === "prop" ? <>
            <label>几何形状<Select aria-label="布景形状" value={item.shape} onValueChange={shape => patch(item.id,{shape,size:[...propCatalog[shape].size]})}>{Object.entries(stageShapes).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
            <Axes field="size" label="尺寸" item={item} apply={f => patch(item.id,f)} />
            <label>布景颜色<input aria-label="布景颜色" type="color" value={item.color} onChange={e => patch(item.id,{color:e.target.value})}/></label>
          </> : item.type === "actor" ? <>
            <label>姿势<Select aria-label="角色姿势" value={item.pose} onValueChange={pose => patch(item.id,{ pose })}>
              {Object.entries(stagePoses).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</Select></label>
            <div className="ds-inline"><div className="ds-field">比例<NumberField label="角色比例" prefix="×" value={item.scale} min={0.1} max={6} step={0.05} change={scale => patch(item.id, { scale })} /></div>
            <label>角色颜色<input aria-label="角色颜色" type="color" value={item.color} onChange={e => patch(item.id, { color: e.target.value })} /></label></div>
          </> : <><div className="ds-field">垂直视角<NumberField label="机位视角角度" prefix="°" value={item.fov} min={15} max={100} step={1} change={fov => patch(item.id, { fov })} /></div>
            <button className="ds-align" disabled={!ready || view !== "director"} onClick={() => patch(item.id, viewport.current.cameraFromDirector())}><Crosshair size={15} />机位对齐导演视角</button>
          </>}
          <button className="ds-remove" disabled={item.type === "camera" && cameras.length === 1} onClick={remove}><Trash2 size={14} />移除{{actor:"角色",prop:"布景",camera:"机位"}[item.type]}</button>
        </div>}
      </aside>
    </div>
    {timeline && <StageTimeline stage={base} track={cutTrack ? "cuts" : selected} frame={frame} playing={playing}
      togglePlay={() => { previewEnd.current = null; setWalkMode(false); if (!playing && frame >= end) seek(0); setPlaying(v => !v); }} seek={seek} select={selectTrack}
      addKey={() => {
        const id=cutTrack ? "cuts" : selected;
        editStage(s=>cutTrack ? cutCamera(s,item?.type==="camera" ? item.id : stage.cameraId,frame) : keyObject(s,selected,frame),"记录关键帧");
        setMarkers([{track:id,frame}]);
      }}
      markers={markers} pick={setMarkers} editKeys={changeKeys} duration={duration} close={toggleTimeline} />}
    <footer className="ds-footer"><button className="ds-time-open" aria-pressed={timeline} onClick={toggleTimeline}><ListVideo size={16}/>动画时间轴</button><button className="ds-time-open" aria-pressed={walkMode} onClick={openWalk}><Footprints size={15}/>走位</button><button className="ds-time-open" onClick={openMotion}><Route size={15}/>运镜</button><span className="ds-hint">{timeline ? "拖框多选 · Delete 删除" : view === "director" ? "拖动空白处环绕 · 滚轮缩放" : "当前机位取景"}</span>
      <div className="ds-frame-options"><Video size={15} /><Select aria-label="取景机位" value={stage.cameraId} onValueChange={id => { setPlaying(false); choose(id); if (timeline) editStage(s => cutCamera(s,id,frame)); setView("camera"); }}>
        {cameras.map(o => <option value={o.id} key={o.id}>{o.name || "未命名机位"}</option>)}</Select><i />{ratioSelect}</div>
      <span className="ds-feedback" role="status">{feedback}</span>
      <button className="ds-capture" disabled={!ready || busy} onClick={take}><Camera size={16} />{busy ? "处理中…" : "截图到画布"}</button>
      <button className="ds-capture ds-export-open" disabled={!ready || busy} onClick={() => { setPlaying(false); setWalkMode(false); setExportOpen(true); }}><Film size={16}/>导出视频到画布</button>
    </footer>
    {exportOpen && <StageExport stage={base} targets={board.nodes.filter(n => n.data.kind === "video")} viewport={viewport} flush={flush}
      save={(blob,target,receipt) => captureVideo(node.id,blob,target,receipt)} close={() => setExportOpen(false)}/>}
    {library && <StageModels close={() => setLibrary(false)} add={shape => add("prop",shape)}/>}
    {vision && <StageVision images={images} nodeId={node.id} projectId={board.id} flush={flush} append={!untouched} apply={apply} close={() => setVision(false)} />}
  </dialog>, document.body);
}
