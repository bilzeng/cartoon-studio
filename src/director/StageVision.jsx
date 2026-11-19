import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Camera, Check, ChevronLeft, ChevronRight, LoaderCircle, PersonStanding, ScanEye, Settings2 } from "lucide-react";
import { Modal } from "../ui";
import { Select } from "../Select";
import { api } from "../client";
import { PromptModelSettings, useProfiles } from "../PromptOptimizer";
import { maxStageReferences } from "../../shared/stage-references";

export function StageVision({ images, nodeId, projectId, flush, append, apply, close }) {
  const [ids,setIds] = useState(() => images.filter(a => a.connected).slice(0,maxStageReferences).map(a => a.id));
  const [profileId,setProfile] = useState(() => localStorage.getItem("studio-director-vision-model") || "");
  const [manage,setManage] = useState(false), [reload,setReload] = useState(0);
  const { profiles,loadError } = useProfiles(reload);
  const model = profiles?.find(p => p.id === profileId) || profiles?.[0];
  const [note,setNote] = useState(""), [pending,setPending] = useState(false), [error,setError] = useState(""), [draft,setDraft] = useState(null);
  const request = useRef(null), form = useRef(null);
  const [columns,setColumns] = useState(4), [firstImage,setFirstImage] = useState(0);
  const pageSize = columns * 2;
  const pages = Math.max(1, Math.ceil(images.length / pageSize));
  const page = Math.min(pages - 1, Math.floor(firstImage / pageSize));
  useLayoutEffect(() => {
    const el = form.current;
    const measure = () => setColumns(Math.max(1, Math.min(4, Math.floor((el.clientWidth + 8) / 112))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  },[]);
  useEffect(() => () => request.current?.abort(),[]);
  function choose(id) {
    setError("");
    if (ids.includes(id)) setIds(ids.filter(x => x !== id));
    else if (ids.length < maxStageReferences) setIds([...ids,id]);
    else setError("一次最多选择 4 张参考图");
  }
  async function analyze() {
    if (!model || !ids.length || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setPending(true); setError("");
    try {
      await flush();
      const plan = await api("/projects/"+encodeURIComponent(projectId)+"/nodes/"+encodeURIComponent(nodeId)+"/director-scene",
        "POST",{ assetIds:ids,profileId:model.id,note },controller.signal);
      if (!controller.signal.aborted) setDraft(plan);
    } catch (e) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (!controller.signal.aborted) setPending(false); request.current = null; }
  }
  function accept() {
    try {
      if (draft.referenceIds.some(id => !images.some(a => a.id === id))) throw Error("所选参考图已离开画布，请重新识图");
      apply(draft);
    } catch (e) { setError(e.message); }
  }
  return <><Modal title="AI 识图搭景" close={close}>
    <div className="ds-vision" ref={form}>
      {draft ? <><h3>搭景草案</h3><div className="ds-plan">{draft.objects.map(o => {
        const Icon = o.type === "actor" ? PersonStanding : o.type === "camera" ? Camera : Box;
        return <div key={o.id}><Icon size={15}/>{o.name}<small>{o.type === "actor" ? "角色" : o.type === "camera" ? "机位" : "布景"}</small></div>;
      })}</div></> : <>
        <div className="ds-vision-label"><h3>画布参考图</h3><span>首张用于构图 · 已选 {ids.length}/{maxStageReferences}</span></div>
        {images.length ? <div className="ds-ref-picker">
          <div className="ds-ref-grid" data-paged={pages>1 || undefined} style={{"--ref-columns":columns}}>
          {images.slice(page*pageSize,(page+1)*pageSize).map(a => <button key={a.id} disabled={pending} aria-pressed={ids.includes(a.id)}
          title={a.title} aria-label={"选择参考图 "+a.title} onClick={() => choose(a.id)}>
          <span className="ds-ref-image"><img src={a.url} alt="" loading="lazy" /></span>
          <span className="ds-ref-name">{a.title}</span>
          {ids.includes(a.id) && <b>{ids.indexOf(a.id)+1}</b>}</button>)}</div>
          {pages>1 && <nav className="ds-ref-pages" aria-label="参考图分页">
            <span>{images.length} 张参考图</span>
            <button aria-label="上一页参考图" disabled={page===0} onClick={()=>setFirstImage((page-1)*pageSize)}><ChevronLeft size={14}/></button>
            <output aria-live="polite">{page+1} / {pages}</output>
            <button aria-label="下一页参考图" disabled={page===pages-1} onClick={()=>setFirstImage((page+1)*pageSize)}><ChevronRight size={14}/></button>
          </nav>}</div>
          : <p>请先在画布添加一张图片，再打开识图搭景。</p>}
        <div className="ds-model-choice"><label>视觉模型<Select aria-label="视觉模型" disabled={!profiles?.length || pending}
          value={model?.id || ""} onValueChange={id => { setProfile(id); localStorage.setItem("studio-director-vision-model",id); }}>
          {!profiles?.length && <option value="">{profiles ? "尚未配置模型" : "正在读取模型"}</option>}
          {(profiles || []).map(p => <option value={p.id} key={p.id}>{p.name} · {p.model}</option>)}</Select></label>
          <button className="outline" title="管理视觉模型" aria-label="管理视觉模型" disabled={pending} onClick={() => setManage(true)}><Settings2 size={16}/></button></div>
        <label>搭景要求<textarea aria-label="搭景要求" disabled={pending} rows="2" maxLength="1200" value={note}
          placeholder="可选，例如让两人隔桌对坐，机位从门口拍摄" onChange={e => setNote(e.target.value)} /></label>
      </>}
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      <footer>{draft ? <><button className="outline" onClick={() => { setDraft(null); setError(""); }}>重选参考图</button>
        <button className="primary" onClick={accept}><Check size={15}/>{append ? "追加到当前场景" : "应用搭景草案"}</button></>
        : <><button className="outline" onClick={close}>{pending ? "取消识图" : "取消"}</button>
          <button className="primary" disabled={pending || !ids.length || !model} onClick={analyze}>{pending ? <LoaderCircle size={15} className="generation-spin"/> : <ScanEye size={15}/>}
            {pending ? "正在识图…" : "识图搭景"}</button></>}</footer>
    </div>
    </Modal>
    {manage && <PromptModelSettings close={() => { setManage(false); setReload(v => v+1); }} />}
  </>;
}
