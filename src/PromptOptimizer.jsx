import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LoaderCircle,
  Plus,
  RefreshCw,
  Radio,
  SlidersHorizontal,
  PencilLine,
  X,
} from "lucide-react";
import { api } from "./client";
import { Modal } from "./ui";
import { Select } from "./Select";
import { durationText } from "../shared/job-timing";
import "./prompt-optimizer.css";

const services = {
  DeepSeek: ["chat", "https://api.deepseek.com/v1"],
  OpenAI: ["responses", "https://api.openai.com/v1"],
  Anthropic: ["anthropic", "https://api.anthropic.com/v1"],
  Gemini: ["gemini", "https://generativelanguage.googleapis.com/v1beta"],
  自定义服务: ["chat", ""],
};
const protocols = {
  chat: "OpenAI Chat Completions",
  responses: "OpenAI Responses",
  anthropic: "Anthropic Messages",
  gemini: "Gemini generateContent",
};
const fresh = (name = "DeepSeek") => ({
  name,
  protocol: services[name][0],
  baseUrl: services[name][1],
  model: "",
  key: "",
});
export function useProfiles(reload) {
  const [profiles, setProfiles] = useState(null);
  const [loadError, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    api("/prompt-models").then(
      (rows) => active && setProfiles(rows),
      (e) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, [reload]);
  return { profiles, loadError };
}
function ModelConnection({ draft, setDraft, hasSavedKey, busy }) {
  const { id, protocol, baseUrl, key, model } = draft;
  const connection = useMemo(
    () => ({ id, protocol, baseUrl, key }),
    [id, protocol, baseUrl, key],
  );
  const [refresh, setRefresh] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [manual, setManual] = useState(false);
  const [probe, setProbe] = useState(null);
  const testController = useRef(null);
  const ready = /^https?:\/\/[^\s/]+/i.test(baseUrl.trim());
  const setModel = (value) => setDraft((d) => ({ ...d, model: value }));
  useEffect(() => {
    if (
      !ready ||
      (!key.trim() && !hasSavedKey && refresh?.connection !== connection)
    )
      return;
    const controller = new AbortController();
    const load = async () => {
      setCatalog({ connection, loading: true });
      try {
        const { models } = await api(
          "/prompt-models/discover",
          "POST",
          connection,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setCatalog({ connection, models });
        if (models.length === 1)
          setDraft((d) => (d && !d.model ? { ...d, model: models[0].id } : d));
      } catch (e) {
        if (!controller.signal.aborted)
          setCatalog({ connection, error: e.message });
      }
    };
    const timer = setTimeout(
      load,
      refresh?.connection === connection ? 0 : 800,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [connection, ready, hasSavedKey, refresh, setDraft, key]);
  useEffect(() => {
    setProbe(null);
    return () => testController.current?.abort();
  }, [connection, model]);
  async function testModel() {
    testController.current?.abort();
    const controller = new AbortController();
    testController.current = controller;
    setProbe({ connection, model, loading: true });
    try {
      const { elapsedMs } = await api(
        "/prompt-models/test",
        "POST",
        { ...connection, model },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setProbe({
          connection,
          model,
          success: true,
          message: `${model} 已回复 · ${(elapsedMs / 1000).toFixed(1)} 秒`,
        });
    } catch (e) {
      if (!controller.signal.aborted)
        setProbe({ connection, model, message: e.message });
    }
  }
  const current = catalog?.connection === connection ? catalog : null;
  const tested =
    probe?.connection === connection && probe.model === model ? probe : null;
  const models = current?.models || [];
  const enterId = !models.length || manual;
  return (
    <>
      <label>
        API Key
        <input
          type="password"
          autoComplete="new-password"
          value={key}
          placeholder={
            hasSavedKey ? "已保存，留空沿用当前密钥" : "本地免密服务可留空"
          }
          onChange={(e) => {
            const value = e.target.value;
            setDraft((d) => ({ ...d, key: value }));
          }}
        />
      </label>
      <div className="opt-model-field">
        <div className="opt-model-heading">
          <label htmlFor="prompt-model-id">模型 ID</label>
          <button
            type="button"
            disabled={!ready || busy || current?.loading}
            onClick={() => {
              setManual(false);
              setRefresh({ connection });
            }}
          >
            <RefreshCw
              size={13}
              className={current?.loading ? "generation-spin" : ""}
            />
            {current?.loading
              ? "获取中…"
              : models.length
                ? "刷新模型"
                : "获取模型"}
          </button>
        </div>
        {enterId ? (
          <input
            id="prompt-model-id"
            required
            maxLength={256}
            placeholder="输入模型 ID，或从服务获取"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        ) : (
          <Select
            id="prompt-model-id"
            aria-label="模型 ID"
            value={model}
            onValueChange={setModel}
          >
            <option value="" disabled>
              请选择模型
            </option>
            {model && !models.some((m) => m.id === model) && (
              <option value={model}>{model}</option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name === m.id ? m.id : m.name + " · " + m.id}
              </option>
            ))}
          </Select>
        )}
        <div className="opt-model-meta">
          <small role={current?.error ? "alert" : "status"}>
            {current?.error
              ? current.error + "。可手动填写模型 ID。"
              : current?.models
                ? models.length
                  ? `已获取 ${models.length} 个模型`
                  : "服务返回了空列表，可手动填写模型 ID。"
                : "填好 API Key 后自动获取模型"}
          </small>
          {models.length > 0 && (
            <button type="button" onClick={() => setManual(!manual)}>
              {manual ? "从列表选择" : "手动填写"}
            </button>
          )}
        </div>
      </div>
      <div className="opt-model-test">
        <button
          type="button"
          className="outline"
          disabled={!ready || !model.trim() || busy || tested?.loading}
          onClick={testModel}
        >
          {tested?.loading ? (
            <LoaderCircle size={15} className="generation-spin" />
          ) : (
            <Radio size={15} />
          )}{" "}
          {tested?.loading ? "测试中…" : "测试模型"}
        </button>
        {tested?.message && (
          <small
            className={tested.success ? "opt-test-ok" : ""}
            role={tested.success ? "status" : "alert"}
          >
            {tested.message}
          </small>
        )}
      </div>
    </>
  );
}

export function PromptModelSettings({ close }) {
  const [reload, refresh] = useState(0);
  const { profiles, loadError } = useProfiles(reload);
  const [draft, setDraft] = useState(null);
  const [preset, setPreset] = useState("DeepSeek");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [deleting, setDeleting] = useState(false);
  const original = profiles?.find((p) => p.id === draft?.id);
  const field = (key, value) =>
    setDraft((d) => ({
      ...d,
      ...(["baseUrl", "protocol"].includes(key) && d[key] !== value
        ? { key: "" }
        : {}),
      [key]: value,
    }));

  const edit = (p) => {
    setSaved("");
    setDraft({ ...p, key: "" });
    setError("");
    setDeleting(false);
  };
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setDeleting(false);
    setError("");
    try {
      await api("/prompt-models", "POST", draft);
      setSaved(draft.name + " 已保存");
      setDraft(null);
      refresh((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api("/prompt-models/" + draft.id, "DELETE");
      setDraft(null);
      refresh((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="提示词模型" close={close}>
      {draft ? (
        <form className="opt-form" onSubmit={save}>
          <div className="form opt-fields">
            <div className="opt-field-pair">
              {!draft.id && (
                <label>
                  服务模板
                  <Select
                    value={preset}
                    onValueChange={(v) => {
                      setPreset(v);
                      setDraft(fresh(v));
                    }}
                  >
                    {Object.keys(services).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                </label>
              )}
              <label>
                显示名称
                <input
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => field("name", e.target.value)}
                />
              </label>
            </div>
            <label>
              接口协议
              <Select
                value={draft.protocol}
                onValueChange={(v) => field("protocol", v)}
              >
                {Object.entries(protocols).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              API 基础地址
              <input
                required
                type="url"
                placeholder="https://your-service.com/v1"
                value={draft.baseUrl}
                onChange={(e) => field("baseUrl", e.target.value)}
              />
            </label>
            <ModelConnection
              key={JSON.stringify([draft.id, draft.protocol, draft.baseUrl])}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              hasSavedKey={
                !!original?.hasKey &&
                original.baseUrl === draft.baseUrl.trim().replace(/\/+$/, "") &&
                original.protocol === draft.protocol
              }
            />
          </div>
          <footer className="opt-footer">
            {error ? (
              <p role="alert">{error}</p>
            ) : !draft.model.trim() && (
              <small>请选择或填写模型 ID 后保存。</small>
            )}
            <div className="opt-actions">
              {draft.id && (
                <button
                  type="button"
                  className="quiet opt-remove"
                  disabled={busy}
                  onClick={() => (deleting ? remove() : setDeleting(true))}
                >
                  {deleting ? "确认删除配置" : "删除配置"}
                </button>
              )}
              <button
                type="button"
                className="outline"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                取消
              </button>
              <button
                className="solid"
                disabled={busy || !draft.model.trim()}
                type="submit"
              >
                {busy && !deleting ? "正在保存…" : "保存模型"}
              </button>
            </div>
          </footer>
        </form>
      ) : (
        <div className="opt-list">
          {saved && <p className="opt-saved" role="status">{saved}</p>}
          {loadError && <p role="alert">{loadError}</p>}
          {profiles?.map((p) => (
            <button className="outline" key={p.id} onClick={() => edit(p)}>
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.model} · {protocols[p.protocol]}
                </small>
              </span>
              <SlidersHorizontal size={16} />
            </button>
          ))}
          {profiles?.length === 0 && (
            <p>添加模型后，可在图片、视频和音频节点中优化提示词。</p>
          )}
          <button
            className="solid"
            onClick={() => {
              setPreset("DeepSeek");
              edit(fresh());
            }}
          >
            <Plus size={16} />
            添加模型
          </button>
        </div>
      )}
    </Modal>
  );
}

const profilePreference = "cartoon-studio.prompt-optimizer.profile";

export function PromptOptimizer({ inputError, started, onStart, onCancel }) {
  const [manage, setManage] = useState(false);
  const [reload, setReload] = useState(0);
  const { profiles, loadError } = useProfiles(reload);
  const [chosen, choose] = useState(() => localStorage.getItem(profilePreference));
  const selected = profiles?.find((p) => p.id === chosen) || profiles?.[0];
  const [now, setNow] = useState(Date.now);
  const busy = started !== undefined;
  const elapsed = busy ? Math.max(0, now - started) : 0;
  useEffect(() => {
    if (started === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [started]);

  function selectProfile(id) {
    if (id === "manage") {
      setManage(true);
      return;
    }
    choose(id);
    localStorage.setItem(profilePreference, id);
  }

  if (loadError) return <button onClick={() => setReload((n) => n + 1)} title={loadError}>
    <RefreshCw size={14} /> 重试加载优化模型
  </button>;

  return (
    <>
      <div className="opt-split" role="group" aria-label="提示词优化">
        <button type="button" disabled={!selected || busy || !!inputError}
          title={inputError || (selected ? "使用 " + selected.name + " · " + selected.model : "请先配置提示词模型")}
          aria-busy={busy} aria-label={busy ? "优化中…" : undefined} onClick={() => onStart(selected.id)}>
          {busy ? <LoaderCircle size={14} className="generation-spin" /> : <PencilLine size={14} />}
          {busy ? <>优化中 <small className="opt-elapsed">{durationText(elapsed)}</small></> : "优化提示词"}
        </button>
        {busy ? <button type="button" className="opt-cancel" aria-label="取消优化" title="取消优化"
          onClick={onCancel}><X size={14} /></button>
          : selected ? <Select
          aria-label={"选择优化模型，当前为 " + selected.name + " · " + selected.model}
          title={selected.name + " · " + selected.model + "，点击切换优化模型"}
          menuAlign="end" menuMinWidth={244} menuClassName="opt-profile-menu"
          renderOption={({ value, label }) => {
            if (value === "manage") return <span className="opt-profile-settings"><SlidersHorizontal size={14} aria-hidden />{label}</span>;
            const profile = profiles.find(p => p.id === value);
            return <span className="opt-profile-label">
              <strong>{profile.model}</strong>
              {profile.name !== profile.model && <small>{profile.name}</small>}
            </span>;
          }}
          value={selected.id} onValueChange={selectProfile} disabled={busy}>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
          <option value="manage">管理提示词模型</option>
        </Select> : profiles && <button onClick={() => setManage(true)}>配置模型</button>}
      </div>
      {manage && createPortal(<PromptModelSettings close={() => {
        setManage(false);
        setReload((n) => n + 1);
      }} />, document.body)}
    </>
  );
}
