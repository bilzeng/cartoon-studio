import { Select } from "./Select";
import { defaultMaxSide } from "../shared/generation-size";
import React, { useEffect, useState } from "react";
import { Modal } from "./ui";
import { WorkflowImport } from "./WorkflowSettings";
import { api } from "./client";
export const environmentEvent = "studio-comfy-environment";
export function EnvironmentSettings({ close, notify }) {
  const [importing, showImport] = useState(false);
  const [maxSide, setMaxSide] = useState(defaultMaxSide);
  const [token, setToken] = useState("");
  const [config, setConfig] = useState(null),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function choose(profile) {
    setToken("");
    setMaxSide(profile?.maxSide ?? defaultMaxSide);
    setUrl(profile?.url || "");
    setName(profile?.name || "");
    setError("");
  }
  useEffect(() => {
    let live = true;
    api("/environments")
      .then((c) => {
        if (live) {
          setConfig(c);
          choose(c.profiles.find((p) => p.url === c.active));
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/environments", "PUT", {
        url: url.trim(),
        name: name.trim(),
        maxSide: Number(maxSide),
        ...(token && { token }),
      });
      window.dispatchEvent(new Event(environmentEvent));
      localStorage.setItem(
        environmentEvent,
        JSON.stringify([result.active, Date.now()]),
      );
      notify(
        "已连接 " +
          name +
          (result.version ? " · ComfyUI " + result.version : ""),
      );
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (importing)
    return (
      <WorkflowImport
        notify={notify}
        close={() => showImport(false)}
        onSaved={() => {
          window.dispatchEvent(new Event(environmentEvent));
          localStorage.setItem(environmentEvent, String(Date.now()));
        }}
      />
    );
  return (
    <Modal title="ComfyUI 环境" close={close}>
      <form className="env-form" id="studio-environment-form" onSubmit={submit}>
        {config && (
          <label>
            已保存的环境
            <Select
              aria-label="已保存的环境"
              disabled={busy}
              value={config.profiles.some((p) => p.url === url) ? url : ""}
              onValueChange={(next) =>
                choose(config.profiles.find((p) => p.url === next))
              }
            >
              {config.profiles.map((p) => (
                <option key={p.url} value={p.url}>
                  {p.name}
                  {p.url === config.active ? " · 使用中" : ""}
                </option>
              ))}
              <option value="">添加新环境…</option>
            </Select>
          </label>
        )}
        <label>
          环境名称
          <input
            required
            maxLength={80}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 工作室 GPU"
          />
        </label>
        <label>
          服务地址
          <input
            required
            type="url"
            disabled={busy}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setToken("");
            }}
            placeholder="http://主机:8188"
          />
        </label>
        <label>
          Bearer 令牌（可选）
          <input
            type="password"
            autoComplete="new-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="已保存的地址留空可沿用令牌"
          />
        </label>
        <label>
          生成尺寸最长边（像素）
          <input
            required
            type="number"
            min={16}
            max={131072}
            value={maxSide}
            onChange={(e) => setMaxSide(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
      </form>
      <footer className="env-actions">
        {config && (
          <button type="button" className="outline" onClick={() => showImport(true)}>
            为当前环境导入工作流…
          </button>
        )}
        <button form="studio-environment-form" type="submit" className="solid" disabled={!config || busy}>
          {busy ? "正在测试连接…" : "测试并切换"}
        </button>
      </footer>
    </Modal>
  );
}
