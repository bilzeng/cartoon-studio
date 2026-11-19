import React, { useId, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";
import { updateTags } from "../shared/asset-tags.js";
import { Modal } from "./ui";

const difference = (tags, other) => tags.filter(tag => !other.includes(tag));

export function AssetTagEditor({ target, vocabulary, onSave, close }) {
  const { asset, ids, importing } = target;
  const automatic = asset?.autoTags || [];
  const original = asset?.customTags || [];
  const oldHidden = asset?.hiddenTags || [];
  const [custom, setCustom] = useState(original);
  const [hidden, setHidden] = useState(oldHidden);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fieldId = useId();
  const suggestions = difference(vocabulary, [...automatic, ...custom]);
  function withText(values) {
    const additions = values.map(t => t.trim().normalize("NFC")).filter(Boolean);
    return {
      custom: updateTags(custom, difference(additions, automatic)),
      hidden: difference(hidden, additions),
    };
  }
  function apply(values) {
    const next = withText(values);
    setCustom(next.custom);
    setHidden(next.hidden);
    setText("");
  }
  const pending = text.split(/[,，、\n]/);
  function toggleAuto(tag) {
    if (hidden.includes(tag)) setHidden(difference(hidden, [tag]));
    else {
      setHidden([...hidden, tag]);
      setCustom(difference(custom, [tag]));
    }
  }
  async function save(e) {
    e.preventDefault();
    if (saving) return;
    const next = withText(pending);
    setError("");
    setSaving(true);
    try {
      await onSave({
        add: difference(next.custom, original), remove: difference(original, next.custom),
        hide: difference(next.hidden, oldHidden), show: difference(oldHidden, next.hidden),
      });
      close();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }
  const title = importing ? "带标签导入" : asset ? "编辑标签" : "批量加标签";
  return createPortal(<Modal title={title} close={() => { if (!saving) close(); }}>
    <form className="asset-tag-form" onSubmit={save}>
      <div className="tag-editor-body">
        <p className="tag-target">{asset ? asset.name : importing ? "这些标签将用于本次选择的所有文件。" : `为已选的 ${ids.length} 项素材添加标签。`}</p>
        {automatic.length > 0 && <fieldset>
          <legend>自动标签</legend>
          <div className="editable-tags">{automatic.map(tag => <button type="button" key={tag}
            aria-pressed={!hidden.includes(tag)} onClick={() => toggleAuto(tag)}>
            {hidden.includes(tag) ? <Plus size={13} /> : <Check size={13} />}{tag}
          </button>)}</div>
        </fieldset>}
        <div className="tag-field">
          <label htmlFor={fieldId}>自定义标签</label>
          {difference(custom, automatic).length > 0 && <div className="editable-tags">
            {difference(custom, automatic).map(tag => <button type="button" key={tag}
              aria-label={"移除标签：" + tag} onClick={() => setCustom(difference(custom, [tag]))}>
              {tag}<X size={13} />
            </button>)}
          </div>}
          <div className="tag-entry">
            <input id={fieldId} value={text} placeholder="输入标签，多个用逗号分隔"
              onChange={e => setText(e.target.value)} onKeyDown={e => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  apply(pending);
                }
              }} />
            <button type="button" className="outline" disabled={!text.trim()} onClick={() => apply(pending)}>添加</button>
          </div>
        </div>
        {suggestions.length > 0 && <details className="tag-suggestions">
          <summary>选择已有标签</summary>
          <div className="editable-tags">{suggestions.map(tag => <button type="button" key={tag}
            onClick={() => apply([...pending, tag])}><Plus size={13} />{tag}</button>)}</div>
        </details>}
        {error && <p role="alert">{error}</p>}
      </div>
      <footer><button className="quiet" type="button" disabled={saving} onClick={close}>取消</button>
        <button className="solid" type="submit" disabled={saving || (ids && !custom.length && !text.trim())}>
          {importing ? "选择文件" : saving ? "保存中…" : "保存标签"}
        </button></footer>
    </form>
  </Modal>, document.body);
}
