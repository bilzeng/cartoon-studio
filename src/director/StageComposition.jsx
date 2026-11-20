import React, { useEffect, useState } from "react";
import { Image as Picture, Video } from "lucide-react";
import { Modal } from "../ui";
import { compositionPlan } from "../../shared/stage-composition";

export function StageComposition({take, assets, save, close}) {
  const [kind,setKind] = useState("image"), [url,setUrl] = useState("");
  const [saving,setSaving] = useState(false), [error,setError] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(take.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  },[take.blob]);
  const subjects = take.subjects.map(s => take.stage.objects.find(o => o.id === s.id));
  async function submit() {
    setSaving(true); setError("");
    try {
      const plan = compositionPlan(take.stage,take.subjects,assets,kind);
      await save(plan);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return <Modal title="构图出片" close={() => { if (!saving) close(); }}>
    <div className="ds-composition">
      <figure>{url && <img src={url} alt="当前机位的构图截图"/>}<figcaption>{take.name} · {take.stage.ratio}</figcaption></figure>
      {subjects.length > 0 && <ul aria-label="入镜角色">{subjects.map(a => {
        const ref = assets.find(s => s.id === a.referenceAssetId);
        return <li key={a.id}><i style={{background:a.color}}/>{a.name}{ref && <img src={ref.url} alt={ref.name} title={ref.name}/>}</li>;
      })}</ul>}
      <div className="ds-choice" role="group" aria-label="生成节点类型">
        <button disabled={saving || !!take.receipt.target} aria-pressed={kind==="image"} onClick={() => setKind("image")}><Picture size={15}/>图片分镜</button>
        <button disabled={saving || !!take.receipt.target} aria-pressed={kind==="video"} onClick={() => setKind("video")}><Video size={15}/>视频分镜</button>
      </div>
      <p>构图截图和已绑定的参考图会一起接入生成节点，可在画布继续编辑提示词。</p>
      {error && <div role="alert">{error}</div>}
      <div className="ds-submit"><button disabled={saving} className="primary" onClick={submit}>{saving ? "正在创建…" : "创建分镜节点"}</button></div>
    </div>
  </Modal>;
}
