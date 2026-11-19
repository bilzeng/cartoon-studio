import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { groupPortId, regroupNodes } from "../shared/canvasGroups";

export function useCanvasSelection({
  board,
  groupMap,
  selected,
  selectSingle,
  edit,
  resetMenu,
  notify,
}) {
  const [multi, setMulti] = useState([]);
  const ids = useMemo(
    () => (multi.length ? multi : selected ? [selected] : []),
    [multi, selected],
  );
  const current = useRef(ids);
  current.current = ids;
  const choose = useCallback(
    (next) => {
      const unique = [...new Set(next)];
      current.current = unique;
      setMulti(unique.length > 1 ? unique : []);
      selectSingle(unique.length === 1 ? unique[0] : "");
    },
    [selectSingle],
  );
  const select = useCallback((id) => choose(id ? [id] : []), [choose]);
  const [pan, setPan] = useState(false),
    [space, setSpace] = useState(false);
  const hand = pan || space;
  const focusedGroup = groupMap.get(selected);
  const picked =
    focusedGroup?.members || board.nodes.filter((n) => ids.includes(n.id));
  const keys = new Set(picked.map((n) => n.data.canvasGroup).filter(Boolean));
  const canGroup =
    picked.length >= 2 &&
    !(keys.size === 1 && picked.every((n) => n.data.canvasGroup));
  function changeGroup(remove) {
    if (remove ? !keys.size : !canGroup) return;
    const pickedIds = new Set(picked.map((n) => n.id));
    const members = board.nodes
      .filter((n) => keys.has(n.data.canvasGroup) || pickedIds.has(n.id))
      .map((n) => n.id);
    const names = new Set([...groupMap.values()].map((g) => g.name));
    let number = 1;
    while (names.has("编组 " + number)) number++;
    const existing = [...groupMap.values()].find((g) => keys.has(g.key));
    const key = remove ? "" : existing?.key || crypto.randomUUID();
    const name = existing?.name || "编组 " + number;
    try {
      edit((b) => regroupNodes(b, members, key, name));
      choose(remove ? members : [groupPortId(key)]);
      notify(remove ? "已取消编组" : "已将节点编组");
    } catch (e) {
      notify(e.message);
    }
  }
  useEffect(() => {
    function key(e) {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        document.querySelector("dialog[open],[role=dialog]") ||
        e.target?.closest?.(
          "input,textarea,[role=combobox],[role=listbox],[contenteditable=true],[role=textbox]",
        )
      )
        return;
      const k = e.key.toLowerCase(),
        mod = e.metaKey || e.ctrlKey;
      if (
        e.code === "Space" &&
        !mod &&
        !e.altKey &&
        !e.target?.closest?.("button,a")
      ) {
        e.preventDefault();
        setSpace(true);
        return;
      }
      if (mod && !e.altKey && k === "g") {
        e.preventDefault();
        if (!e.repeat) changeGroup(e.shiftKey);
        return;
      }
      if (mod && !e.altKey && k === "a") {
        e.preventDefault();
        choose(board.nodes.map((n) => n.id));
        return;
      }
      if (!mod && !e.altKey && (k === "v" || k === "h")) {
        setPan(k === "h");
        resetMenu(null);
      }
    }
    function up(e) {
      if (e.code === "Space") setSpace(false);
    }
    function blur() {
      setSpace(false);
    }
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [board.nodes, choose, changeGroup, resetMenu]);
  return {
    ids,
    current,
    choose,
    select,
    hand,
    pan,
    setPan,
    canGroup,
    canUngroup: !!keys.size,
    changeGroup,
  };
}
