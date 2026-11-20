import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Play, Square, PersonStanding, RotateCcw } from "lucide-react";
import { actionPresets, jointControls } from "../../shared/stage-actions";
import { stageFps } from "../../shared/stage-animation";
import { figure } from "./figure";
import { modelPreviews } from "./props";

let previews;
export function StageActions({ actor, timeline, frame, patch, viewport, busy }) {
  const [category,setCategory] = useState("全部"), [part,setPart] = useState("头部");
  const [images,setImages] = useState(previews);
  const gesture = useRef(null);
  const [audition,setAudition] = useState(false);
  const period = actionPresets[actor.pose]?.period;
  useEffect(() => { setAudition(false); },[actor.pose,frame,timeline,busy]);
  useEffect(() => {
    if (!audition || !period || busy) return;
    const start = performance.now();
    let raf;
    function tick(now) {
      viewport.current?.previewAction(actor.id,((now-start)*stageFps/(period*1000))%1);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); viewport.current?.previewAction(actor.id,null); };
  },[actor.id,period,viewport,busy,audition]);
  useEffect(() => {
    if (previews) return;
    try {
      previews = modelPreviews(Object.entries(actionPresets),id => {
        const model = figure("#afcec5",id);
        if (actionPresets[id].category === "武打") model.setGait(undefined,.4);
        return model;
      },
        {width:108,height:108,elevation:1});
      setImages(previews);
    } catch { /* Accessible preset names also work on devices without a second GL context. */ }
  },[]);
  const parts = {"躯干":["torsoLean","torsoTwist"],"头部":["headTurn","headTilt"],"左臂":["leftArm","leftSpread","leftElbow"],
    "右臂":["rightArm","rightSpread","rightElbow"],"左腿":["leftHip","leftKnee"],"右腿":["rightHip","rightKnee"]};
  return <section className="ds-actions" aria-label="角色动作库">
    <div className="ds-action-target"><strong>{actor.name}</strong><span>{timeline ? "第 "+frame+" 帧" : "基础姿势"}</span></div>
    <div className="ds-action-categories" role="group" aria-label="动作分类">{["全部","姿态","移动","交流","武打"].map(label =>
      <button key={label} aria-pressed={category === label} onClick={() => setCategory(label)}>{label}</button>)}</div>
    <div className="ds-action-grid">{Object.entries(actionPresets).filter(([,p]) => category === "全部" || category === p.category).map(([id,p]) =>
      <button key={id} aria-pressed={actor.pose === id} onClick={() => { if (actor.pose !== id) patch({pose:id,joints:{}}); }}>
        {images?.[id] ? <img src={images[id]} alt=""/> : <PersonStanding size={24}/>}
        <span>{p.name}</span>{actor.pose === id && <Check size={12} className="ds-action-check"/>}
      </button>)}</div>
    {period && <button className="ds-audition" disabled={busy} aria-pressed={audition} onClick={()=>setAudition(!audition)}>
      {audition ? <Square size={12}/> : <Play size={12}/>} {audition ? "停止预览" : "预览动作"}</button>}
    <details className="ds-joints"><summary>关节微调<ChevronDown size={14}/></summary>
      <div className="ds-action-categories" role="group" aria-label="选择关节">{Object.keys(parts).map(p =>
        <button key={p} aria-pressed={p===part} onClick={()=>setPart(p)}>{p}</button>)}</div>
      {parts[part].map(id => {
        const [label,min,max] = jointControls[id], value = Math.round(actor.joints?.[id] || 0);
        return <label key={id}><span>{label}<output>{value}°</output></span>
          <input type="range" min={min} max={max} value={value} aria-label={label}
            onPointerDown={e=>{gesture.current=Symbol(); e.currentTarget.setPointerCapture(e.pointerId);}}
            onLostPointerCapture={()=>{gesture.current=null;}} onBlur={()=>{gesture.current=null;}}
            onChange={e=>patch({joints:{...actor.joints,[id]:Number(e.target.value)}},gesture.current)}/></label>;
      })}
      <button className="ds-reset-joints" disabled={!Object.values(actor.joints || {}).some(Boolean)} onClick={()=>patch({joints:{}})}><RotateCcw size={13}/>还原预设关节</button>
    </details>
  </section>;
}
