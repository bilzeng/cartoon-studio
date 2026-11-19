import React, { useEffect, useRef, useState } from "react";
import { Film, LoaderCircle } from "lucide-react";
import { Modal } from "../ui";
import { Select } from "../Select";
import { endFrameOf, stageFps } from "../../shared/stage-animation";
import { encodeTimeline, videoSize } from "./export-video";

export function StageExport({ stage, targets, viewport, flush, save, close }) {
  const [target,setTarget] = useState("new"), [progress,setProgress] = useState(null);
  const [saving,setSaving] = useState(false), [error,setError] = useState("");
  const controller = useRef(null), movie = useRef(null), receipt = useRef({});
  useEffect(() => () => controller.current?.abort(),[]);
  const frames = endFrameOf(stage);
  function dismiss() {
    if (saving) return;
    controller.current?.abort(); close();
  }
  async function run() {
    if (controller.current) return;
    const task = new AbortController(); controller.current = task;
    setError(""); setProgress(0);
    try {
      await flush();
      movie.current ??= await encodeTimeline(viewport.current,stage,task.signal,(n,total) => setProgress(Math.floor(n*100/total)));
      task.signal.throwIfAborted(); setSaving(true);
      await save(movie.current,target,receipt.current);
    } catch (e) {
      if (!task.signal.aborted) { setError(e.message); setProgress(null); setSaving(false); }
    } finally { controller.current = null; }
  }
  return <Modal title="导出导演台视频" close={dismiss}><div className="ds-export">
    <p>{videoSize(stage.ratio).join(" × ")} · {stageFps} fps · {Number((frames/stageFps).toFixed(2))} 秒 · MP4</p>
    <label>视频参考接到<Select aria-label="视频参考接到" disabled={progress !== null || !!receipt.current.clip} value={target} onValueChange={setTarget}>
      <option value="new">新建视频节点</option>{targets.map(n => <option key={n.id} value={n.id}>{n.data.title}</option>)}
      <option value="only">仅放到画布</option></Select></label>
    {progress !== null && <div role="status"><progress value={progress} max="100"/><span>{saving ? "正在放到画布…" : "正在编码 "+progress+"%"}</span></div>}
    {error && <p role="alert">{error}</p>}
    <footer><button className="outline" disabled={saving} onClick={dismiss}>取消</button><button className="primary" disabled={progress !== null} onClick={run}>
      {progress !== null ? <LoaderCircle size={15} className="generation-spin"/> : <Film size={15}/>}导出到画布</button></footer>
  </div></Modal>;
}
