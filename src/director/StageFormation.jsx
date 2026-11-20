import React, { useState } from "react";
import { UsersRound } from "lucide-react";
import { Modal } from "../ui";
import { formations, formationPoints } from "../../shared/stage-composition";
import { castProfiles, crowdProfile } from "../../shared/stage-cast";
import { Select } from "../Select";

export function StageFormation({max, apply, close}) {
  const [pattern,setPattern] = useState("circle"), [count,setCount] = useState(Math.min(max,6));
  const [spacing,setSpacing] = useState(1.2);
  const [cast,setCast] = useState("mixed");
  const points = formationPoints(pattern,count,spacing);
  const extent = Math.max(2,...points.flatMap(({x,z}) => [Math.abs(x),Math.abs(z)]));
  return <Modal title="布置群演" close={close}>
    <div className="ds-formation">
      <div className="ds-formation-map" role="img" aria-label={formations[pattern]+"俯视图"}>
        <div className="ds-map-points"><i className="ds-origin" />{points.map(({x,z},i) => <i key={i} style={{
          left:(50+42*x/extent)+"%",top:(50+42*z/extent)+"%",width:8*castProfiles[crowdProfile(cast,i)].shoulders,
        }}/>)}</div>
      </div>
      <div className="ds-choice" role="group" aria-label="队形">{Object.entries(formations).map(([id,label]) =>
        <button key={id} aria-pressed={pattern===id} onClick={() => setPattern(id)}>{label}</button>)}</div>
      <label>人数 <input aria-label="群演人数" type="range" min="2" max={max} value={count} onChange={e => setCount(Number(e.target.value))}/><output>{count} 人</output></label>
      <label>间距 <input aria-label="群演间距" type="range" min=".6" max="4" step=".1" value={spacing} onChange={e => setSpacing(Number(e.target.value))}/><output>{spacing.toFixed(1)} m</output></label>
      <label>体型 <Select aria-label="群演体型" value={cast} onValueChange={setCast}><option value="mixed">混合体型</option>
        {Object.entries(castProfiles).map(([id,p]) => <option key={id} value={id}>{p.name}</option>)}</Select></label>
      <div className="ds-submit"><button className="primary" onClick={() => apply(pattern,count,spacing,cast)}><UsersRound size={15}/> 放入场景</button></div>
    </div>
  </Modal>;
}
