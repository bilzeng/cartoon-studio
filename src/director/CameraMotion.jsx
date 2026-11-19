import React, { useState } from "react";
import { Route } from "lucide-react";
import { Select } from "../Select";
import { cameraMoves, cameraEasings, cameraProgress, isOrbit, usesAngle } from "../../shared/stage-camera";
import { stageFps } from "../../shared/stage-animation";

export function CameraMotion({ stage, frame, apply, lastMove, preview, append }) {
  const [move,setMove] = useState("push"), [seconds,setSeconds] = useState("2"), [amount,setAmount] = useState("1");
  const [easing,setEasing] = useState("smooth");
  const [target,setTarget] = useState("");
  const subjects = stage.objects.filter(o => o.type !== "camera");
  const targetId = target || subjects.find(o => o.type === "actor")?.id || "center";
  function changeMove(next) {
    if (usesAngle(next) !== usesAngle(move)) setAmount(usesAngle(next) ? "45" : "1");
    setMove(next);
  }
  return <fieldset className="ds-motion"><legend>镜头轨道</legend>
    <Select aria-label="运镜方式" value={move} onValueChange={changeMove}>
      {Object.entries(cameraMoves).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</Select>
    <label>速度曲线<span className="ds-easing"><svg viewBox="0 0 44 24" aria-hidden="true">
      <path d="M2 2v20h40" fill="none" stroke="currentColor" opacity=".3"/>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.6"
        points={Array.from({length:21},(_,i) => [2+2*i,22-20*cameraProgress(i/20,easing)].join(",")).join(" ")}/>
    </svg><Select aria-label="运镜速度曲线" value={easing} onValueChange={setEasing}>
      {Object.entries(cameraEasings).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</Select></span></label>
    <div className="ds-motion-values">
      <label>时长（秒）<input aria-label="运镜时长" type="number" min=".042" max="120" step=".25" value={seconds} onChange={e => setSeconds(e.target.value)}/></label>
      <label>{usesAngle(move) ? "角度（°）" : "距离（米）"}<input aria-label="运镜幅度" type="number" min=".01" step={usesAngle(move) ? 5 : .1} value={amount} onChange={e => setAmount(e.target.value)}/></label>
    </div>
    {(isOrbit(move) || move === "dollyZoom") && <label>{isOrbit(move) ? "环绕中心" : "变焦主体"}<Select aria-label={isOrbit(move) ? "环绕中心" : "变焦主体"} value={subjects.some(o => o.id === targetId) ? targetId : "center"} onValueChange={setTarget}>
      <option value="center">镜头前方</option>{subjects.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</Select></label>}
    <button className="ds-align" onClick={() => apply({move,easing,frames:Math.round(Number(seconds)*stageFps),amount:Number(amount),targetId})}>
      <Route size={14}/>从 {(frame/stageFps).toFixed(2)} s 添加运镜</button>
    {lastMove && <div className="ds-motion-follow"><button onClick={preview}>预览本段</button><button onClick={append}>接下一段</button></div>}
  </fieldset>;
}
