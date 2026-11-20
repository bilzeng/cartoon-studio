import { useEffect, useRef, useState } from "react";
import { optimizedNodeChanges, optimizedPromptError } from "../shared/prompt-optimizer";
import { api } from "./client";
import { canvasModelInputs, nodePromptOptimization } from "./canvasModelInputs";

function readRequest(board, nodeId, assets, engine) {
  const node = board?.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return null;
  const media = canvasModelInputs(board,node,assets,engine);
  const optimization = nodePromptOptimization(board,node,media);
  return optimization && {...optimization,node,resolved:media.resolved};
}

export function usePromptOptimizations({ board, assets, engine, edit, flush, notify }) {
  const project = board?.id;
  const endpoint = "/projects/" + encodeURIComponent(project || "") + "/prompt-optimizations";
  const submitting = useRef(new Map());
  const applied = useRef(new Set());
  const [tasks,setTasks] = useState([]);
  const [local,setLocal] = useState({});
  const [version,readAgain] = useState(0);

  useEffect(() => {
    if (!project) return;
    let live = true, timer;
    async function poll() {
      try {
        const rows = await api(endpoint);
        if (!live) return;
        setTasks(rows);
        if (!rows.some(task => task.status === "running")) return;
      } catch {
        if (!live) return;
      }
      timer = setTimeout(poll,1250);
    }
    function resume() { clearTimeout(timer); readAgain(n => n + 1); }
    void poll();
    window.addEventListener("focus",resume);
    return () => { live = false; clearTimeout(timer); window.removeEventListener("focus",resume); };
  },[endpoint,project,version]);

  useEffect(() => {
    if (!project || !engine) return;
    for (const task of tasks) {
      if (task.status !== "done" || applied.current.has(task.id)) continue;
      const request = readRequest(board,task.nodeId,assets,engine);
      if (!request || request.basis !== task.basis) continue;
      applied.current.add(task.id);
      const issue = optimizedPromptError(task.text,request.context);
      if (issue) {
        setLocal(prev => ({...prev,[task.nodeId]:{error:issue}}));
        continue;
      }
      let title;
      edit(latest => {
        const current = readRequest(latest,task.nodeId,assets,engine);
        if (current?.basis !== task.basis) return latest;
        const {node,context,resolved} = current;
        const changes = optimizedNodeChanges(node.data,context,resolved,task.text.trim());
        title = node.data.title;
        return {...latest,nodes:latest.nodes.map(n => n.id === task.nodeId ?
          {...n,data:{...n.data,...changes,[n.data.kind+"PromptOptimization"]:undefined}} : n)};
      });
      if (title !== undefined) notify(title+" · 提示词已更新");
    }
  },[board,assets,engine,tasks,project,edit,notify]);

  function localState(nodeId,state) {
    setLocal(prev => {
      const next = {...prev};
      if (state) next[nodeId] = state;
      else delete next[nodeId];
      return next;
    });
  }
  function removeTask(task) {
    return api(endpoint + "/" + encodeURIComponent(task.nodeId) + "/" + encodeURIComponent(task.id),"DELETE");
  }
  async function start(nodeId,profileId) {
    if (submitting.current.has(nodeId) || tasks.some(task => task.nodeId === nodeId && task.status === "running")) return;
    const request = readRequest(board,nodeId,assets,engine);
    if (!request || request.inputError) return;
    const operation = {cancelled:false};
    submitting.current.set(nodeId,operation);
    localState(nodeId,{started:Date.now()});
    try {
      await flush();
      if (operation.cancelled) return;
      const task = await api("/prompt-optimizer/run","POST",{profileId,projectId:project,nodeId,
        context:request.context,basis:request.basis});
      if (operation.cancelled) await removeTask(task);
      else setTasks(rows => [...rows.filter(row => row.nodeId !== nodeId),task]);
      localState(nodeId);
    } catch (error) {
      if (!operation.cancelled) localState(nodeId,{error:error.message});
    } finally {
      submitting.current.delete(nodeId);
      readAgain(n => n + 1);
    }
  }
  async function cancel(nodeId) {
    const operation = submitting.current.get(nodeId);
    if (operation) operation.cancelled = true;
    localState(nodeId);
    const task = tasks.find(t => t.nodeId === nodeId && t.status === "running");
    if (!task) return;
    try {
      await removeTask(task);
      setTasks(rows => rows.filter(row => row.id !== task.id));
    } catch (error) { notify(error.message); }
    finally { readAgain(n => n + 1); }
  }
  const states = {...local};
  for (const task of tasks) {
    if (task.status === "running") states[task.nodeId] = {started:task.started};
    else if (task.status === "failed" && !states[task.nodeId]) states[task.nodeId] = {error:task.error};
  }
  return {states,start,cancel};
}
