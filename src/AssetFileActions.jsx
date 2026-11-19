import React, { useState } from "react";
import { Download, FolderOpen } from "lucide-react";
import { api } from "./client";
import "./asset-file-actions.css";

export function AssetFileActions({ asset, projectId, compact = false }) {
  const [error, setError] = useState("");
  const filename = asset.diskFile?.split("/").at(-1) || asset.name;
  const kind = { image: "图片", video: "视频", audio: "音频" }[asset.kind] || "文件";

  async function reveal() {
    setError("");
    try {
      await api("/assets/" + encodeURIComponent(asset.id) + "/folder", "POST", { projectId });
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="asset-file-actions nodrag nopan" data-compact={compact || undefined} role="group" aria-label="文件操作"
      onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <a href={asset.url} download={filename} title={compact ? "下载" + kind : filename} aria-label={"下载" + kind}>
        <Download size={14} />{!compact && "下载" + kind}
      </a>
      <button type="button" onClick={reveal} title={compact ? "打开文件位置" : undefined} aria-label="打开文件位置">
        <FolderOpen size={14} />{!compact && "打开文件位置"}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
