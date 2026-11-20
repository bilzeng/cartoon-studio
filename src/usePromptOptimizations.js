import { useEffect, useRef, useState } from "react";
import { optimizedNodeChanges, optimizedPromptError } from "../shared/prompt-optimizer";
import { api } from "./client";
import { canvasModelInputs, nodePromptOptimization } from "./canvasModelInputs";

function readRequest(board, nodeId, assets, engine) {
  const node = board?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const media = canvasModelInputs(board, node, assets, engine);
  const optimization = nodePromptOptimization(board, node, media);
  return optimization && { ...optimization, node, resolved: media.resolved };
}

export function usePromptOptimizations({ board, assets, engine, edit, notify }) {
  const requests = useRef(new Map());
  const runtime = useRef(null);
  runtime.current = { board, assets, engine };
  const [states, setStates] = useState({});

  function finish(task, error) {
    if (requests.current.get(task.nodeId) !== task) return;
    requests.current.delete(task.nodeId);
    setStates((previous) => {
      const next = { ...previous };
      if (error) next[task.nodeId] = { error };
      else delete next[task.nodeId];
      return next;
    });
  }
  function cancel(nodeId) {
    const task = requests.current.get(nodeId);
    if (!task) return;
    task.controller.abort();
    finish(task);
  }

  useEffect(() => {
    for (const [nodeId, task] of requests.current) {
      if (readRequest(board, nodeId, assets, engine)?.basis !== task.basis) cancel(nodeId);
    }
  }, [board, assets, engine]);
  useEffect(() => {
    const active = requests.current;
    return () => {
      for (const task of active.values()) task.controller.abort();
      active.clear();
    };
  }, []);

  async function start(nodeId, profileId) {
    if (requests.current.has(nodeId)) return;
    const initial = readRequest(board, nodeId, assets, engine);
    if (!initial || initial.inputError) return;
    const controller = new AbortController();
    const task = { nodeId, controller, basis: initial.basis };
    requests.current.set(nodeId, task);
    const started = Date.now();
    setStates((previous) => ({ ...previous, [nodeId]: { started } }));
    const timeout = setTimeout(() => {
      controller.abort();
      finish(task, "提示词优化等待超时，请检查模型服务后重试。");
    }, 190000);
    try {
      const { text } = await api("/prompt-optimizer/run", "POST", {
        profileId, context: initial.context,
      }, controller.signal);
      if (controller.signal.aborted) return;
      const current = runtime.current;
      if (readRequest(current.board, nodeId, current.assets, current.engine)?.basis !== task.basis) return;
      const issue = optimizedPromptError(text, initial.context);
      if (issue) return finish(task, issue);
      let applied;
      edit((latest) => {
        const request = readRequest(latest, nodeId, current.assets, current.engine);
        if (request?.basis !== task.basis) return latest;
        const { node, context, resolved } = request;
        const changes = optimizedNodeChanges(node.data, context, resolved, text.trim());
        applied = node.data.title;
        return { ...latest, nodes: latest.nodes.map((n) => n.id === nodeId
          ? { ...n, data: { ...n.data, ...changes, [n.data.kind + "PromptOptimization"]: undefined } }
          : n) };
      });
      if (applied !== undefined) notify(applied + " · 提示词已更新");
    } catch (e) {
      if (!controller.signal.aborted)
        finish(task, e instanceof TypeError ? "与工作室的连接中断，请重试优化。" : e.message);
    } finally {
      clearTimeout(timeout);
      finish(task);
    }
  }

  return { states, start, cancel };
}
