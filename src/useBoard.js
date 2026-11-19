import { useCallback, useEffect, useRef, useState } from "react";
import { settleCanvasJobs } from "../shared/canvas";
import { api } from "./client";
import { kinds, makeNode } from "../shared/studio";
export function useBoard(id, initialKind, notify) {
  const [board, setBoard] = useState(null),
    [status, setStatus] = useState("读取中"),
    [error, setError] = useState("");
  const current = useRef(null),
    saved = useRef(null),
    active = useRef(null),
    rev = useRef(0),
    timer = useRef(),
    conflict = useRef(false);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (active.current) return active.current;
    if (conflict.current) throw Error("画布版本冲突，请下载草稿后重新打开项目");
    active.current = (async () => {
      while (current.current && current.current !== saved.current) {
        const snapshot = current.current;
        setStatus("保存中");
        try {
          const result = await api("/projects/" + id, "PUT", {
            ...snapshot,
            revision: rev.current,
          });
          rev.current = result.revision;
          saved.current = snapshot;
        } catch (e) {
          conflict.current = e.status === 409;
          setStatus("保存失败");
          throw e;
        }
      }
      setStatus("已保存");
      return rev.current;
    })();
    try {
      return await active.current;
    } finally {
      active.current = null;
    }
  }, [id]);
  const edit = useCallback(
    (fn) => {
      const next = fn(current.current);
      current.current = next;
      setBoard(next);
      setStatus("待保存");
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => flush().catch((e) => notify(e.message)),
        400,
      );
    },
    [flush, notify],
  );
  useEffect(() => {
    let alive = true;
    api("/projects/" + id)
      .then((b) => {
        if (!alive) return;
        current.current = saved.current = b;
        rev.current = b.revision;
        setBoard(b);
        setStatus("已保存");
        if (
          Object.hasOwn(kinds, initialKind) &&
          initialKind !== "script" &&
          b.nodes.length === 1 &&
          b.revision === 1
        ) {
          const n = makeNode(initialKind, { x: 325, y: 50 });
          edit((old) => ({
            ...old,
            nodes: [...old.nodes, n],
            order: initialKind === "shot" ? [n.id] : old.order,
          }));
        }
      })
      .catch((e) => alive && setError(e.message));
    function guard(e) {
      if (current.current !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", guard);
    return () => {
      alive = false;
      window.removeEventListener("beforeunload", guard);
      clearTimeout(timer.current);
      if (current.current !== saved.current)
        flush().catch((e) => notify(e.message));
    };
  }, [id, initialKind, edit, flush, notify]);
  return { board, edit, flush, status, error };
}

export function useCanvasResults(board, edit, refresh) {
  const project = board?.id;
  const pending = JSON.stringify(
    (board?.nodes || [])
      .filter((n) => n.data.pendingCanvasJob)
      .map((n) => [n.id, n.data.pendingCanvasJob]),
  );
  useEffect(() => {
    const targets = JSON.parse(pending);
    if (!project || !targets.length) return;
    let live = true,
      timer;
    async function poll() {
      const finished = new Map();
      try {
        await Promise.all(
          targets.map(async ([nodeId, jobId]) => {
            const rows = await api(
              "/projects/" +
                project +
                "/nodes/" +
                encodeURIComponent(nodeId) +
                "/jobs?job=" +
                encodeURIComponent(jobId),
            );
            const job = rows.find((j) => j.id === jobId);
            if (job?.status !== "running")
              finished.set(jobId, { ...job, nodeId });
          }),
        );
        if (!live) return;
        if (finished.size) {
          await refresh();
          if (live) edit((b) => settleCanvasJobs(b, finished));
        }
      } finally {
        if (live) timer = setTimeout(() => poll().catch(() => {}), 1700);
      }
    }
    poll().catch(() => {});
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [project, pending, edit, refresh]);
}
