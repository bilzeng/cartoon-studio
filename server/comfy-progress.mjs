import WebSocket from "ws";

// Keep only the latest node update. The existing history poll publishes it to
// Studio, so fast samplers never turn one progress event into one disk write.
export function watchExecution(base, token, clientId, graph) {
  const url = new URL(base.replace(/\/$/, "") + "/ws");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("clientId", clientId);
  let socket,
    retry,
    target,
    stopped = false;
  const latest = new Map();
  let stream = "connecting";
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function connect() {
    socket = new WebSocket(url, {
      handshakeTimeout: 2500,
      perMessageDeflate: false,
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    socket.on("open", () => {
      stream = "connected";
      resolveReady();
    });
    socket.on("error", () => {
      stream = "offline";
      resolveReady();
    });
    socket.on("close", () => {
      stream = "offline";
      resolveReady();
      if (!stopped) retry = setTimeout(connect, 6000);
    });
    socket.on("message", (message, binary) => {
      if (binary || stopped) return;
      let event;
      try {
        event = JSON.parse(message.toString());
      } catch {
        return;
      }
      const { type, data } = event || {};
      const id = data?.prompt_id;
      if (typeof id !== "string" || (target && id !== target)) return;
      const previous = latest.get(id);
      let stage, value, max;
      if (type === "execution_start") stage = "开始执行";
      else if (type === "execution_success") stage = "执行完成，正在获取结果";
      else if (type === "executing" || type === "progress") {
        if (data.node == null) return;
        const node = graph[String(data.node)];
        stage =
          node?._meta?.title || node?.class_type || "工作流节点 " + data.node;
        if (type === "progress") {
          if (
            !Number.isFinite(data.value) ||
            !Number.isFinite(data.max) ||
            data.max <= 0
          )
            return;
          value = Math.min(data.max, Math.max(0, data.value));
          max = data.max;
        }
      } else return;
      if (
        previous &&
        previous.node === data.node &&
        previous.stage === stage &&
        previous.value === value &&
        previous.max === max
      )
        return;
      // Before POST /prompt returns, targeted events may already be in flight.
      if (!target && latest.size >= 32 && !previous)
        latest.delete(latest.keys().next().value);
      latest.set(id, {
        stage,
        node: data.node,
        value,
        max,
        updatedAt: new Date().toISOString(),
        startedAt: previous?.startedAt || new Date().toISOString(),
      });
    });
  }
  connect();
  return {
    ready,
    bind(id) {
      target = id;
    },
    read() {
      return { stream, step: latest.get(target) };
    },
    close() {
      stopped = true;
      clearTimeout(retry);
      socket.terminate();
    },
  };
}
