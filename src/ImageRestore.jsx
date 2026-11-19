import React from "react";
import { Select } from "./Select";

export function ImageRestore({ refs, source, onSource, size, limit, onSize, strength, onStrength, original }) {
  const percent = Math.round(strength * 100);
  return (
    <div className="image-restore">
      {source?.asset && <img src={source.asset.url} alt="待修复原图" />}
      <div>
        <strong>{original ? "RelayVSR ×2 原流程" : "高清修复"}</strong>
        {refs.length > 1 || (!source && refs.length > 0) ? (
          <Select
            aria-label="修复原图"
            value={source?.id || ""}
            onValueChange={onSource}
          >
            {!source && (
              <option value="" disabled>
                选择原图
              </option>
            )}
            {refs.map((r) => (
              <option value={r.id} key={r.id}>
                {r.title}
              </option>
            ))}
          </Select>
        ) : (
          <small>{source?.title || "请上传或连接一张原图"}</small>
        )}
      </div>
      <label>
        输出长边
        <span>
          <input
            aria-label="输出长边"
            type="number"
            min="1"
            max={limit}
            value={size || ""}
            onChange={(e) => onSize(Number(e.target.value))}
          />{" "}
          px
        </span>
      </label>
      {!original && <label className="restore-strength">
        <span>细节增强 <output>{percent}%</output></span>
        <input
          type="range"
          aria-label="细节增强"
          aria-valuetext={percent + "%"}
          min="0" max="100" step="1" value={percent}
          onChange={(e) => onStrength(Number(e.target.value) / 100)}
        />
        <span className="restore-range-labels"><span>原图放大</span><span>强增强</span></span>
      </label>}
    </div>
  );
}
