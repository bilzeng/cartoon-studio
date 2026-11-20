import React, {useState} from "react";
import {LoaderCircle, RefreshCw} from "lucide-react";
import {api} from "./client";

export function RecoverGeneration({jobId, className, onRecovered, onError}) {
  const [busy,setBusy] = useState(false);
  async function recover() {
    setBusy(true);
    try {
      const job = await api("/jobs/" + encodeURIComponent(jobId) + "/recover","POST");
      await onRecovered(job);
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  return <button type="button" className={className} onClick={recover} disabled={busy}
    title="查询 ComfyUI 中的原任务，继续跟踪或取回结果">
    {busy ? <LoaderCircle size={14} className="generation-spin"/> : <RefreshCw size={14}/>}
    {busy ? "正在重连" : "重连取回"}
  </button>;
}
