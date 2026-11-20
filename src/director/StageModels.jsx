import React, { useEffect, useRef, useState } from "react";
import { Box, Upload } from "lucide-react";
import { Modal } from "../ui";
import { propCatalog } from "../../shared/stage-props";
import { propPreviews } from "./props";
import { Select } from "../Select";

export function StageModels({ mode, add, close, actor, assets, importFile, importing, error }) {
  const [images,setImages] = useState({});
  const [hand,setHand] = useState("");
  const [placement,setPlacement] = useState("prop");
  const picker = useRef(null);
  const isImport = mode === "import", isWeapon = mode === "weapon";
  useEffect(() => {
    if (isImport) return;
    try { setImages(propPreviews()); } catch { /* Model names remain usable without WebGL. */ }
  },[isImport]);
  if (isImport) return <Modal title="三维模型" close={() => { if (!importing) close(); }}>
    <div className="ds-model-library">
      <div className="ds-library-toolbar">
        <Select aria-label="模型放置方式" value={placement} onValueChange={setPlacement} disabled={importing}>
          <option value="prop">作为布景放入</option><option value="actor">作为角色放入</option>
        </Select>
        <button className="primary" disabled={importing} onClick={() => picker.current.click()}><Upload size={15}/>{importing ? "正在导入…" : "导入模型文件"}</button>
        <input ref={picker} type="file" hidden aria-label="三维模型文件" accept=".glb,.gltf,.obj" onChange={e => {
          const file = e.target.files[0]; e.target.value = "";
          if (file) importFile(file,placement);
        }}/>
      </div>
      <small>支持 GLB、内嵌 glTF 和 OBJ，单个文件最大 24 MB。</small>
      {error && <p role="alert">{error}</p>}
      {assets.length > 0 && <div className="ds-imported-models">{assets.map(asset =>
        <button key={asset.id} disabled={importing} onClick={() => add(asset,placement)}><Box size={16}/><span>{asset.name}</span>
          <small>{asset.model.format.toUpperCase()}{asset.model.clips.length > 0 && " · "+asset.model.clips.length+" 段动画"}</small></button>)}</div>}
    </div>
  </Modal>;
  return <Modal title={isWeapon ? "兵器库" : "布景模型库"} close={close}>
    <div className="ds-model-library">
      {isWeapon && actor && <div className="ds-library-toolbar"><strong>{actor.name}</strong>
        <Select aria-label="道具放置方式" value={hand} onValueChange={setHand}>
          <option value="">摆放到场景</option><option value="left">装备到左手</option><option value="right">装备到右手</option>
        </Select></div>}
      {(isWeapon ? ["兵器道具"] : ["家具","建筑","室外","基础几何"]).map(group =>
      <div key={group}><h3>{group}</h3><div className="ds-model-grid">
        {Object.entries(propCatalog).filter(([,p]) => p.group === group).map(([id,p]) =>
          <button key={id} onClick={() => add(id,hand)} aria-label={(hand ? "装备" : "摆放")+p.name}>
            {images[id] ? <img src={images[id]} alt=""/> : <Box size={24}/>}<span>{p.name}</span>
          </button>)}
      </div></div>)}</div>
  </Modal>;
}
