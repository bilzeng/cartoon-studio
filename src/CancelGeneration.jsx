import React, { useState } from "react";
import { LoaderCircle, Square } from "lucide-react";
import { api } from "./client";

export function CancelGeneration({ jobId, className, onCancelled, onError }) {
  const [busy, setBusy] = useState(false);
  async function cancel() {
    setBusy(true);
    try {
      const job = await api("/jobs/" + encodeURIComponent(jobId) + "/cancel", "POST");
      await onCancelled(job);
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className={className} onClick={cancel} disabled={busy}>
      {busy ? <LoaderCircle size={14} className="generation-spin" /> : <Square size={13} />}
      {busy ? "正在取消" : "取消生成"}
    </button>
  );
}
