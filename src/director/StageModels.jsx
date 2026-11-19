import React, { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { Modal } from "../ui";
import { propCatalog } from "../../shared/stage-props";
import { propPreviews } from "./props";

export function StageModels({ add, close }) {
  const [images,setImages] = useState({});
  useEffect(() => {
    try { setImages(propPreviews()); } catch { /* Model names remain usable without WebGL. */ }
  },[]);
  return <Modal title="布景模型库" close={close}>
    <div className="ds-model-library">{["家具","建筑","室外","基础几何"].map(group =>
      <div key={group}><h3>{group}</h3><div className="ds-model-grid">
        {Object.entries(propCatalog).filter(([,p]) => p.group === group).map(([id,p]) =>
          <button key={id} onClick={() => add(id)} aria-label={"摆放"+p.name}>
            {images[id] ? <img src={images[id]} alt=""/> : <Box size={24}/>}<span>{p.name}</span>
          </button>)}
      </div></div>)}</div>
  </Modal>;
}
