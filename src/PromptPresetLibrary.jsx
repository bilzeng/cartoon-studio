import React, { useLayoutEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Modal } from "./ui";
import { promptPresets } from "./prompt-presets";
import "./prompt-presets.css";

export function PromptPresetLibrary({ kind, verbatim, value, close, apply }) {
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const list = useRef(null);
  const presets = promptPresets(kind, verbatim);
  const categories = [...new Set(presets.map((p) => p.category))];
  const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = presets.filter((p) => {
    const searchable = [p.title, p.category, p.text].join(" ").toLowerCase();
    return (!category || category === p.category) &&
      keywords.every((word) => searchable.includes(word));
  });
  const selected = matches.find((p) => p.id === selectedId) || matches[0];
  const separator = value && !value.endsWith("\n") ? "\n" : "";
  const next = selected && value + separator + selected.text;
  const tooLong = next?.length > 40000;

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [category, query]);

  return (
    <Modal wide title="预设提示词" close={close}>
      <div className="prompt-presets">
        <label className="prompt-preset-search">
          <Search size={16} aria-hidden="true" />
          <input autoFocus type="search" aria-label="搜索预设提示词"
            placeholder="搜索关键词，例如 江南、逆光、窗边"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="filters prompt-preset-categories" role="group" aria-label="提示词分类">
          {["", ...categories].map((name) =>
            <button key={name} type="button" aria-pressed={name === category}
              className={name === category ? "active" : ""}
              onClick={() => setCategory(name)}>{name || "全部"}</button>
          )}
        </div>
        <div className="prompt-preset-body">
          <div className="prompt-preset-results">
            <span className="prompt-preset-count" aria-live="polite">共 {matches.length} 条</span>
            <div className="prompt-preset-list" role="group" aria-label="提示词样例" ref={list}>
              {matches.map((p) => (
                <button key={p.id} type="button" aria-pressed={p.id === selected?.id}
                  onClick={() => setSelectedId(p.id)}>
                  <strong>{p.title}</strong>
                  {!category && <small>{p.category}</small>}
                </button>
              ))}
            </div>
          </div>
          <div className="prompt-preset-preview" role="region" aria-label="提示词预览">
            {selected ? (
              <>
                <h3>{selected.title}</h3>
                <p>{selected.text}</p>
              </>
            ) : <p className="empty">没有匹配的预设，可试试其他关键词或分类。</p>}
          </div>
        </div>
        <div className="prompt-preset-actions">
          {tooLong && <small role="alert">追加后超过节点可保存的字数。</small>}
          <button type="button" className="solid" disabled={!selected || tooLong} onClick={() => apply(next)}>
            <Plus size={16} />
            {value.trim() ? "追加到提示词" : "使用此预设"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
