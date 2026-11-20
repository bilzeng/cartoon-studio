import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const endpoint = "/_studio/update";
const pendingKey = "studio:update-pending";
const updating = phase => ["working", "restarting", "starting"].includes(phase);

async function request(method, signal) {
  const response = await fetch(endpoint, { method, signal, cache: "no-store",
    ...(method === "POST" && { headers: { "Content-Type": "application/json" }, body: "{}" }) });
  if (!response.ok) throw Object.assign(Error("更新请求失败（HTTP " + response.status + "）"), { status: response.status });
  const result = await response.json();
  if (typeof result.phase !== "string") throw Error("更新状态无效");
  return result;
}

export function StudioUpdate({ notify }) {
  const [state, setState] = useState({ phase: "checking" });
  const [watch, setWatch] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer, failures = 0;
    async function poll() {
      try {
        const timeout = AbortSignal.timeout?.(5000);
        const signal = timeout && AbortSignal.any ? AbortSignal.any([controller.signal, timeout]) : controller.signal;
        const s = await request("GET", signal);
        if (controller.signal.aborted) return;
        setState(s);
        failures = 0;
        if (updating(s.phase)) {
          if (s.phase !== "starting") sessionStorage.setItem(pendingKey, "1");
          timer = setTimeout(poll, 800);
        } else {
          const waiting = sessionStorage.getItem(pendingKey);
          sessionStorage.removeItem(pendingKey);
          pending.current = false;
          if (waiting && s.phase === "updated") {
            sessionStorage.setItem("studio:updated", s.version);
            location.reload();
          } else if (waiting) notify(s.message || "更新未开始，请重试。");
          else if (sessionStorage.getItem("studio:updated")) {
            notify("工作室已更新至 " + sessionStorage.getItem("studio:updated").slice(0, 7));
            sessionStorage.removeItem("studio:updated");
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        if (!sessionStorage.getItem(pendingKey)) {
          setState({ phase: "unavailable", message: "请用新版启动脚本打开工作室以启用更新。" });
          return;
        }
        if (++failures < 90) {
          setState({ phase: "restarting", message: "正在重新连接工作室…" });
          timer = setTimeout(poll, 1000);
        } else {
          sessionStorage.removeItem(pendingKey);
          pending.current = false;
          setState({ phase: "error", message: "暂时无法连接，请通过启动脚本重新打开工作室。" });
          notify("暂时无法连接，请通过启动脚本重新打开工作室。");
        }
      }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [watch, notify]);

  async function apply() {
    if (pending.current) return;
    pending.current = true;
    sessionStorage.setItem(pendingKey, "1");
    setState({ phase: "working", message: "正在检查主分支…" });
    try {
      await request("POST", AbortSignal.timeout?.(8000));
    } catch (e) {
      if (e.status) {
        sessionStorage.removeItem(pendingKey);
        pending.current = false;
        setState({ phase: "error", message: e.message });
        return;
      }
      // The original server can already be shutting down after accepting the request.
    }
    setWatch(v => !v);
  }
  const busy = updating(state.phase);
  const unavailable = state.phase === "unavailable";
  return <nav aria-label="软件更新" className="studio-update" aria-live="polite">
    <button type="button" onClick={apply} disabled={busy || unavailable || state.phase === "checking"} title={state.version ? "当前版本 " + state.version.slice(0, 7) : undefined}>
      <RefreshCw size={17} />{busy ? "正在更新" : "更新并重启"}
    </button>
    {(busy || unavailable || state.phase === "error") && <small>{state.message}</small>}
  </nav>;
}
