import { Select } from "./Select";
import React from "react";
import { ratios } from "../shared/series";

export function ScriptField({ value, onChange }) {
  return (
    <label>
      本集剧本
      <textarea
        rows={4}
        maxLength={40000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="每行写一个镜头，创建时自动拆镜。也可以稍后在画布上写。"
      />
    </label>
  );
}
export function SeriesFields({ value, onChange, assets }) {
  const set = (key, text) => onChange({ ...value, [key]: text });
  return (
    <>
      <label>
        画幅
        <Select
          value={value.ratio}
          onValueChange={(next) => set("ratio", next)}
        >
          {Object.keys(ratios).map((r, i) => (
            <option key={r} value={r}>
              {["横屏", "竖屏", "方形"][i]} · {r}
            </option>
          ))}
        </Select>
      </label>
      {[
        ["style", "画风", "如：黑白钢笔线稿，阴影用交叉排线"],
        ["cast", "角色设定", "姓名、外形、服装和标志道具"],
        ["world", "世界与场景", "时代、地点、色调和重复出现的场景"],
      ].map(([key, label, hint]) => (
        <label key={key}>
          {label}
          <textarea
            rows={2}
            maxLength={1500}
            value={value[key]}
            onChange={(e) => set(key, e.target.value)}
            placeholder={hint}
          />
        </label>
      ))}
      <label>
        默认参考图
        <Select
          value={value.refAssetId}
          onValueChange={(next) => set("refAssetId", next)}
        >
          <option value="">每个镜头单独选择</option>
          {assets
            .filter((a) => a.kind === "image")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
      </label>
    </>
  );
}
export function Inventory({ inventory }) {
  if (!inventory) return null;
  return (
    <details className="model-list">
      <summary>查看 ComfyUI 已安装模型</summary>
      {Object.entries(inventory).map(([key, files]) => (
        <div key={key}>
          <strong>
            {key}（{files.length}）
          </strong>
          {files.length > 0 && (
            <ul>
              {files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <small>
        模型文件需要配套的加载器和工作流。其他模型可通过自定义 API 工作流接入。
      </small>
    </details>
  );
}
