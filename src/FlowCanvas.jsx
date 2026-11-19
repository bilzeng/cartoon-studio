import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BaseEdge,
  Handle,
  MiniMap,
  SelectionMode,
  Position,
  ReactFlow,
  getBezierPath,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import {
  Activity,
  Aperture,
  Cable,
  ArrowDownToLine,
  BookOpen,
  Boxes,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Film,
  Focus,
  Grid2X2,
  Hand,
  Group,
  Ungroup,
  PencilLine,
  Keyboard,
  Layers,
  ListVideo,
  Map as MapIcon,
  MousePointer2,
  Network,
  Plus,
  Trash2,
  Upload,
  UserRound,
  Waypoints,
  X,
  FolderOpen,
  Maximize2,
} from "lucide-react";
import { useCanvasSelection } from "./useCanvasSelection";
import { AssetPreview, icons, Media, Modal } from "./ui";
import {
  canvasGroups,
  removeCanvasNodes,
  validCanvasEndpoints,
} from "../shared/canvasGroups";
import { addCanvasNode, addCanvasReferences } from "../shared/canvas";
import { outputSize, videoUpscale2kId } from "../shared/generation-size";
import { poseSwapModelId } from "../shared/pose-swap";
import { frameAsset, kinds, makeId, makeNode } from "../shared/studio";
import { environmentEvent } from "./EnvironmentSettings";
import { NodeComposer } from "./NodeComposer";
import { RestoreComparison, restoreOriginal } from "./RestoreComparison";
import { AssetFileActions } from "./AssetFileActions";
import { api, uploadAsset } from "./client";
import "./canvas.css";

const CanvasContext = createContext(null);
const fitOptions = { padding: { x: 36, y: 54 }, maxZoom: 1 };
const minCanvasZoom = 0.15;
const maxCanvasZoom = 8;
const options = ["text", "image", "video", "audio", "script", "shot"];
const motion = () => ({
  duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 210,
  interpolate: "linear",
  ease: (t) => 1 - (1 - t) ** 3,
});
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
const acceptsImageDrop = (data) => data?.kind === "image" && data.imageModel !== poseSwapModelId;
const isFileDrag = (event) => event.dataTransfer?.types.includes("Files");
function imageDropTarget(element) {
  if (element.closest("dialog, [role='dialog']")) return null;
  const node = element.closest("[data-image-drop-target]");
  if (node) return node.dataset.imageDropTarget;
  if (element.closest(".react-flow__node, .composer-anchor, .react-flow__edge")) return null;
  return element.closest(".react-flow__pane") ? "canvas" : null;
}
function dimensions(kind) {
  return kind === "image" || kind === "video"
    ? [364, 205]
    : kind === "shot"
      ? [240, 135]
      : [240, 128];
}
function previewDimensions(data, asset, imageSizes) {
  const frame = dimensions(data.kind);
  if (data.kind !== "image" || data.imageModel !== poseSwapModelId) return frame;
  const [width, height] = imageSizes.get(asset?.id) ||
    (asset?.fileTags?.includes("横图") ? frame
      : asset?.fileTags?.includes("方图") ? [1, 1]
      : asset?.fileTags?.includes("竖图") ? [9, 16]
      : outputSize("image", data.canvasRatio || "9:16", data.customSize));
  const scale = Math.min(frame[0] / width, frame[1] / height);
  return [Math.max(108, Math.round(width * scale)), Math.max(64, Math.round(height * scale))];
}
function WireLight({ path }) {
  return (
    <path
      className="flow-wire-light"
      d={path}
      pathLength="100"
      aria-hidden="true"
    />
  );
}
function CanvasEdge({ id, interactionWidth, markerEnd, ...coords }) {
  const [path] = getBezierPath(coords);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={interactionWidth}
        markerEnd={markerEnd}
      />
      <WireLight path={path} />
    </>
  );
}
const edgeTypes = { default: CanvasEdge };
function ConnectionPreview({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
  connectionStatus,
  fromHandle,
}) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });
  return (
    <g
      className="flow-wire-preview"
      data-reverse={fromHandle.type === "target" || undefined}
    >
      <path d={path} className="flow-wire-track" />
      <WireLight path={path} />
      {connectionStatus === "valid" && (
        <circle className="flow-wire-tip" cx={toX} cy={toY} r={3} />
      )}
    </g>
  );
}

function attractPort(e) {
  if (e.pointerType === "touch" || e.buttons) return;
  const port = e.currentTarget,
    r = port.getBoundingClientRect();
  const dx = clamp((e.clientX - r.left) / r.width - 0.5, -1, 1);
  const dy = clamp((e.clientY - r.top) / r.height - 0.5, -1, 1);
  port.style.setProperty("--pull-x", dx * 4 + "px");
  port.style.setProperty("--pull-y", dy * 4 + "px");
}
function releasePort(e) {
  e.currentTarget.style.removeProperty("--pull-x");
  e.currentTarget.style.removeProperty("--pull-y");
}
function Tile({ id, data, width, selected }) {
  const { board, assets, submittingNodes, setPreview, rememberImageSize, imageDrop } = useContext(CanvasContext),
    Icon = icons[data.kind];
  // React Flow can render a departing tile once more after the board updates.
  const asset =
    data.kind === "shot"
      ? frameAsset({ id, data }, board, assets)
      : assets.find((a) => a.id === data.assetId);
  const words = ["text", "script"].includes(data.kind);
  const generating = submittingNodes.has(id) || !!data.pendingCanvasJob;
  const original = !generating && data.kind === "image" && restoreOriginal(asset, assets);
  return (
    <article className={"flow-tile" + (selected ? " chosen" : "")}>
      <span className="flow-label" title={data.title || kinds[data.kind]}>
        <Icon size={14} />
        <span>{data.title || kinds[data.kind]}</span>
      </span>
      <div
        data-image-drop-target={acceptsImageDrop(data) ? id : undefined}
        data-image-drop-active={imageDrop === id || undefined}
        data-group-image={data.canvasGroup && asset?.kind === "image" && !generating || undefined}
        className="flow-tile-face"
        data-generating={generating || undefined}
        aria-busy={generating || undefined}
      >
        {original ? (
          <RestoreComparison key={asset.id + original.id} original={original} restored={asset} />
        ) : asset?.kind === "image" && data.kind === "image" ? (
          <img
            key={asset.id}
            className="tile-image"
            src={asset.url}
            alt={asset.name}
            onLoad={(e) => {
              const img = e.currentTarget;
              img.classList.add("ready");
              if (data.imageModel === poseSwapModelId)
                rememberImageSize(asset.id, img.naturalWidth, img.naturalHeight);
            }}
          />
        ) : asset ? (
          <Media
            asset={asset}
            controls={selected && !generating}
            className={
              selected && asset.kind !== "image" ? "nodrag nopan" : undefined
            }
          />
        ) : words && data.text ? (
          <p>{data.text}</p>
        ) : (
          <Icon size={37} strokeWidth={1.7} />
        )}
        {asset && !generating && (
          <div className="tile-file-tools">
            <AssetFileActions key={asset.id} asset={asset} projectId={board.id}
              compact={data.imageModel === poseSwapModelId && width < 280} />
            {asset.kind === "image" && <button type="button" className="tile-preview nodrag nopan" aria-label={"放大预览 " + asset.name}
              title="放大预览" onClick={(e) => { e.stopPropagation(); setPreview(asset.id); }}>
              <Maximize2 size={16} />
            </button>}
          </div>
        )}
        {generating && <div className="tile-generation" aria-hidden="true" />}
      </div>
      {["target", "source"].map((side) => (
        <CanvasPort key={side} id={id} side={side} title={data.title} />
      ))}
    </article>
  );
}
function CanvasPort({ id, side, title, hint }) {
  const { portMenu, activePort } = useContext(CanvasContext);
  const label = side === "source" ? "添加下游" : "添加上游";
  function invoke(e) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    portMenu(id, side, r.left + r.width / 2, r.top + r.height / 2);
  }
  return (
    <Handle
      type={side}
      position={side === "source" ? Position.Right : Position.Left}
      className="flow-port"
      data-open={
        activePort?.anchor === id && activePort.side === side ? "" : undefined
      }
      onPointerMove={attractPort}
      onPointerLeave={releasePort}
      role="button"
      tabIndex={0}
      aria-label={title + " · " + label}
      title={hint || label + "，或拖动连线"}
      onClick={invoke}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          invoke(e);
        }
      }}
    >
      <span className="flow-port-cap">
        <Plus size={14} />
      </span>
    </Handle>
  );
}

function AssetGroup({ id, data }) {
  const { selectGroup, renameGroup, moveGroup } = useContext(CanvasContext);
  const { screenToFlowPosition } = useReactFlow();
  const drag = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  function startRename() {
    selectGroup(id);
    setDraft(data.name);
    setEditing(true);
  }
  function finishRename(save) {
    if (save && draft.trim() && draft.trim() !== data.name)
      renameGroup(data.key, draft.trim());
    setEditing(false);
  }
  function delta(e) {
    const point = screenToFlowPosition(
      { x: e.clientX, y: e.clientY },
      { snapToGrid: false },
    );
    return {
      x: point.x - drag.current.start.x,
      y: point.y - drag.current.start.y,
    };
  }
  function end(e, cancelled) {
    const gesture = drag.current;
    if (!gesture || e.pointerId !== gesture.pointer) return;
    const offset = delta(e);
    drag.current = null;
    if (gesture.moved)
      moveGroup(gesture.members, offset, cancelled ? "cancel" : "commit");
  }
  return (
    <div className={"canvas-group-frame" + (data.active ? " active" : "")}>
      <div className="group-heading nodrag nopan">
        {editing ? (
          <input
            className="group-name"
            aria-label="资产组名称"
            maxLength={100}
            value={draft}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finishRename(true)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                finishRename(e.key === "Enter");
              }
            }}
          />
        ) : (
          <>
            <button
              className="group-grip"
              aria-label={"选择资产组 " + data.name}
              title="拖动移动整组，双击改名"
              onClick={() => selectGroup(id)}
              onDoubleClick={startRename}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                selectGroup(id);
                drag.current = {
                  pointer: e.pointerId,
                  start: screenToFlowPosition(
                    { x: e.clientX, y: e.clientY },
                    { snapToGrid: false },
                  ),
                  members: data.members.map((n) => ({
                    id: n.id,
                    position: n.position,
                  })),
                  moved: false,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drag.current || e.pointerId !== drag.current.pointer)
                  return;
                const offset = delta(e);
                if (!drag.current.moved && Math.hypot(offset.x, offset.y) < 2)
                  return;
                drag.current.moved = true;
                moveGroup(drag.current.members, offset, "drag");
              }}
              onPointerUp={(e) => end(e, false)}
              onLostPointerCapture={(e) => end(e, true)}
              onPointerCancel={(e) => end(e, true)}
            >
              <Group size={14} />
              <span>{data.name}</span>
              <small>{data.members.length}</small>
            </button>
            <button
              className="group-rename"
              aria-label={"重命名资产组 " + data.name}
              title="重命名资产组"
              onClick={startRename}
            >
              <PencilLine size={13} />
            </button>
          </>
        )}
      </div>
      {data.active && <span className="group-output-label">引用整组</span>}
      <CanvasPort
        id={id}
        side="source"
        title={data.name}
        hint="连接整组素材，之后可用 @ 选择其中一项"
      />
    </div>
  );
}
const types = { studio: Tile, assetGroup: AssetGroup };
function IconButton({ icon: Icon, label, active, onClick, disabled }) {
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} />
    </button>
  );
}

export function FlowCanvas({
  board,
  assets,
  selected,
  initialPreviewId,
  select: selectSingle,
  edit,
  update,
  flush,
  refresh,
  notify,
  open,
  setMode,
  home,
  status,
  rename,
  onSeries,
  onPreview,
  onSplit,
  onGenerateShot,
  download,
}) {
  const wrap = useRef(null),
    composer = useRef(null);
  const [box, setBox] = useState({ w: 1000, h: 650 }),
    [composerHeight, setHeight] = useState(170);
  const [menu, setMenu] = useState(null),
    [shortcuts, setShortcuts] = useState(false),
    [mini, setMini] = useState(false),
    [edgesVisible, showEdges] = useState(true),
    [snap, setSnap] = useState(false),
    [chosenEdge, setEdge] = useState(""),
    [deletion, setDeletion] = useState(null),
    [engine, setEngine] = useState(null);
  const {
    screenToFlowPosition,
    fitView,
    zoomIn,
    zoomOut,
    setCenter,
    setViewport,
  } = useReactFlow();
  const [previewId, setPreview] = useState(initialPreviewId);
  const preview = previewId && assets.find(a => a.id === previewId);
  const [imageDrop, setImageDrop] = useState(null);
  const [uploadingImages, setUploadingImages] = useState(null);
  const imageUploadActive = useRef(false);
  const [imageSizes, setImageSizes] = useState(() => new Map());
  const rememberImageSize = useCallback((id, width, height) => {
    if (!width || !height) return;
    setImageSizes((previous) => {
      const measured = previous.get(id);
      if (measured?.[0] === width && measured[1] === height) return previous;
      return new Map(previous).set(id, [width, height]);
    });
  }, []);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const groupMap = useMemo(() => canvasGroups(board.nodes), [board.nodes]);
  const nodeIds = useMemo(
    () => new Set(board.nodes.map((n) => n.id)),
    [board.nodes],
  );
  const {
    ids,
    current,
    choose,
    select,
    hand,
    pan,
    setPan,
    canGroup,
    canUngroup,
    changeGroup,
  } = useCanvasSelection({
    board,
    groupMap,
    selected,
    selectSingle,
    edit,
    resetMenu: setMenu,
    notify,
  });
  const view = useViewport();
  const previousWidth = useRef(0);
  const fitOnOpen = useRef(board.nodes.length > 0);
  const node = board.nodes.find((n) => n.id === selected);
  const [dragPositions, setDragPositions] = useState(() => new Map());
  const baseNodes = useMemo(
    () =>
      board.nodes.map((n) => {
        const [width, height] = previewDimensions(n.data, assetsById.get(n.data.assetId), imageSizes);
        // Keep measured handle bounds across controlled position updates.
        return {
          ...n,
          selected: ids.includes(n.id),
          zIndex: 2,
          width,
          height,
          measured: { width, height },
        };
      }),
    [board.nodes, ids, assetsById, imageSizes],
  );
  const members = useMemo(
    () =>
      dragPositions.size
        ? baseNodes.map((n) =>
            dragPositions.has(n.id)
              ? { ...n, position: dragPositions.get(n.id), dragging: true }
              : n,
          )
        : baseNodes,
    [baseNodes, dragPositions],
  );
  const nodes = useMemo(() => {
    const frames = [...canvasGroups(members).values()].map((g) => {
      const x = Math.min(...g.members.map((n) => n.position.x)) - 34;
      const y = Math.min(...g.members.map((n) => n.position.y)) - 66;
      const width =
        Math.max(...g.members.map((n) => n.position.x + n.width)) - x + 34;
      const height =
        Math.max(...g.members.map((n) => n.position.y + n.height)) - y + 25;
      return {
        id: g.id,
        type: "assetGroup",
        data: { ...g, active: selected === g.id },
        position: { x, y },
        width,
        height,
        measured: { width, height },
        selectable: false,
        draggable: false,
        focusable: false,
        zIndex: 1,
      };
    });
    return [...frames, ...members];
  }, [members, selected]);
  const edges = useMemo(
    () =>
      edgesVisible
        ? board.edges.map((e) => ({
            ...e,
            className:
              e.source === selected ||
              e.target === selected ||
              e.id === chosenEdge
                ? "wire-active"
                : undefined,
          }))
        : [],
    [board.edges, edgesVisible, selected, chosenEdge],
  );
  const onNodesChange = useCallback(
    (changes) => {
      const selection = changes.getByType("select");
      if (selection.length) {
        const next = new Set(
          current.current.flatMap(
            (id) => groupMap.get(id)?.members.map((n) => n.id) || [id],
          ),
        );
        for (const c of selection) {
          if (c.selected) next.add(c.id);
          else next.delete(c.id);
        }
        choose([...next]);
      }
      const moves = changes.getByType("position").filter((c) => c.position);
      if (!moves.length) return;
      setDragPositions((previous) => {
        const next = new Map(previous);
        for (const c of moves) {
          if (c.dragging) next.set(c.id, c.position);
          else next.delete(c.id);
        }
        return next;
      });
      const landed = new Map(
        moves.filter((c) => !c.dragging).map((c) => [c.id, c.position]),
      );
      if (landed.size)
        edit((b) => ({
          ...b,
          nodes: b.nodes.map((n) =>
            landed.has(n.id) ? { ...n, position: landed.get(n.id) } : n,
          ),
        }));
    },
    [edit, choose, current, groupMap],
  );
  useEffect(() => {
    // React Flow handles pinch on the graph. Its sibling controls and portaled
    // dialogs also receive Ctrl+wheel from trackpads, but have no graph to zoom.
    function preventPagePinch(event) {
      if (!event.ctrlKey || !event.cancelable || event.defaultPrevented) return;
      // Allow a tab already magnified by the browser to pinch back to normal.
      if (window.visualViewport?.scale > 1 && event.deltaY > 0) return;
      event.preventDefault();
    }
    document.addEventListener("wheel", preventPagePinch, { passive: false });
    return () => document.removeEventListener("wheel", preventPagePinch);
  }, []);
  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect,
        previous = previousWidth.current;
      previousWidth.current = width;
      setBox({ w: width, h: height });
      if (previous && width < 600 !== previous < 600) {
        setMenu(null);
        requestAnimationFrame(() => fitView(fitOptions));
      }
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [fitView]);
  useEffect(() => {
    if (!composer.current) return;
    const ro = new ResizeObserver(() =>
      setHeight(composer.current?.offsetHeight || 170),
    );
    ro.observe(composer.current);
    return () => ro.disconnect();
  }, [selected]);
  useEffect(() => {
    let active = true,
      generation = 0;
    const load = () => {
      const seq = ++generation;
      setEngine(null);
      api("/engine")
        .then((e) => active && generation === seq && setEngine(e))
        .catch(
          () => active && generation === seq && setEngine({ online: false }),
        );
    };
    const storage = (e) => {
      if (e.key === environmentEvent) load();
    };
    load();
    const cover = ({ detail }) =>
      setEngine((prev) =>
        prev?.environment === detail.environment
          ? {
              ...prev,
              loraCovers: { ...prev.loraCovers, [detail.name]: detail.url },
            }
          : prev,
      );
    window.addEventListener("studio-lora-cover", cover);
    window.addEventListener(environmentEvent, load);
    window.addEventListener("storage", storage);
    return () => {
      active = false;
      window.removeEventListener("studio-lora-cover", cover);
      window.removeEventListener(environmentEvent, load);
      window.removeEventListener("storage", storage);
    };
  }, []);
  useEffect(() => {
    const key = (e) => {
      if (document.querySelector("dialog[open]") || e.defaultPrevented) return;
      if (e.key === "Escape") {
        setMenu(null);
        setEdge("");
        if (!menu) select("");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [menu, select]);

  useEffect(() => {
    function handleDelete(e) {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.repeat ||
        e.altKey ||
        document.querySelector("dialog[open],[role=dialog]") ||
        e.target?.closest?.(
          "input,textarea,[role=combobox],[role=listbox],[contenteditable=true],[role=textbox]",
        )
      )
        return;
      if (e.metaKey || e.ctrlKey) {
        if (
          !e.shiftKey &&
          e.key.toLowerCase() === "z" &&
          deletion?.after === board
        ) {
          e.preventDefault();
          edit(() => deletion.before);
          setDeletion(null);
        }
        return;
      }
      if (!["Delete", "Backspace"].includes(e.key)) return;
      const targetIds =
        groupMap.get(selected)?.members.map((n) => n.id) ||
        ids.filter((id) => nodeIds.has(id));
      if (!chosenEdge && !targetIds.length) return;
      e.preventDefault();
      edit((before) => {
        const after =
          chosenEdge && !targetIds.length
            ? {
                ...before,
                edges: before.edges.filter((e) => e.id !== chosenEdge),
              }
            : removeCanvasNodes(before, targetIds);
        setDeletion({ before, after });
        return after;
      });
      setMenu(null);
      setEdge("");
      select("");
    }
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [
    board,
    chosenEdge,
    deletion,
    edit,
    groupMap,
    ids,
    nodeIds,
    select,
    selected,
  ]);

  const openMenu = useCallback(
    (
      x,
      y,
      anchor = "",
      side = "",
      point,
      entry = side === "target" ? Position.Right : Position.Left,
    ) => {
      const r = wrap.current.getBoundingClientRect();
      const width = Math.min(218, box.w - 16),
        height = options.length * 34 + 40;
      const left = clamp(
        x - r.left - (entry === Position.Right ? width : 0),
        8,
        box.w - width - 8,
      );
      const top = clamp(y - r.top, 50, box.h - height - 64);
      setMenu({
        left,
        top,
        width,
        anchor,
        side,
        entry,
        point: point || screenToFlowPosition({ x, y }),
      });
      setEdge("");
      if (anchor) select(anchor);
    },
    [box.w, box.h, screenToFlowPosition, select],
  );
  const portMenu = useCallback(
    (id, side, x, y) => {
      const r = wrap.current.getBoundingClientRect();
      const width = Math.min(218, r.width - 16);
      const roomLeft = x - r.left,
        roomRight = r.right - x;
      const enough = width + 32;
      const toRight =
        roomRight >= enough && roomLeft >= enough
          ? side === "source"
          : roomRight > roomLeft;
      const room = toRight ? roomRight : roomLeft;
      const gap = clamp(room - width - 8, 24, 94);
      const end = x + (toRight ? gap : -gap);
      // Even on a narrow screen leave the active port uncovered.
      const menuY =
        room >= enough ? y - 70 : y < r.top + r.height / 2 ? y + 40 : y - 300;
      openMenu(
        end,
        menuY,
        id,
        side,
        screenToFlowPosition({ x: x + (side === "source" ? 94 : -94), y }),
        toRight ? Position.Left : Position.Right,
      );
    },
    [openMenu, screenToFlowPosition],
  );
  const selectGroup = useCallback(
    (id) => {
      select(id);
      setEdge("");
      setMenu(null);
    },
    [select],
  );
  const renameGroup = useCallback(
    (key, name) => {
      edit((b) => ({
        ...b,
        nodes: b.nodes.map((n) =>
          n.data.canvasGroup === key
            ? { ...n, data: { ...n.data, canvasGroupName: name } }
            : n,
        ),
      }));
    },
    [edit],
  );
  const moveGroup = useCallback(
    (members, offset, phase) => {
      const positions = new Map(
        members.map(({ id, position }) => [
          id,
          { x: position.x + offset.x, y: position.y + offset.y },
        ]),
      );
      if (phase === "commit")
        edit((b) => ({
          ...b,
          nodes: b.nodes.map((n) =>
            positions.has(n.id) ? { ...n, position: positions.get(n.id) } : n,
          ),
        }));
      setDragPositions(phase === "drag" ? positions : new Map());
    },
    [edit],
  );
  const [submittingNodes, setSubmittingNodes] = useState(() => new Set());
  const onMediaSubmission = useCallback((id, active) => {
    setSubmittingNodes((previous) => {
      const next = new Set(previous);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const tileContext = useMemo(
    () => ({
      board,
      assets,
      portMenu,
      activePort: menu,
      setPreview,
      rememberImageSize,
      imageDrop,
      submittingNodes,
      selectGroup,
      renameGroup,
      moveGroup,
    }),
    [
      board,
      assets,
      portMenu,
      menu,
      selectGroup,
      renameGroup,
      moveGroup,
      rememberImageSize,
      imageDrop,
      submittingNodes,
    ],
  );
  function panePalette(e) {
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  }
  function dragImages(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    const target = imageUploadActive.current ? null : imageDropTarget(event.target);
    event.dataTransfer.dropEffect = target ? "copy" : "none";
    setImageDrop(target);
  }
  function leaveImageDrop(event) {
    if (!isFileDrag(event)) return;
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
      setImageDrop(null);
  }
  async function dropImages(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setImageDrop(null);
    const target = imageDropTarget(event.target);
    if (!target || imageUploadActive.current) return;
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: snap });
    imageUploadActive.current = true;
    setUploadingImages(target);
    const added = new Map();
    const failures = [];
    try {
      for (const file of files) {
        if (!wrap.current) return;
        try {
          if (!/\.(png|jpe?g|webp)$/i.test(file.name) && !/^image\/(png|jpeg|webp)$/i.test(file.type))
            throw Error("请选择 PNG、JPG 或 WebP 图片");
          if (file.size > 64 * 1024 * 1024) throw Error("单张图片最多 64 MB");
          const asset = await uploadAsset(file, board.id);
          if (asset.kind !== "image") throw Error("文件不是图片");
          added.set(asset.id, asset);
        } catch (e) {
          failures.push(file.name + "：" + e.message);
        }
      }
      if (!wrap.current) return;
      if (added.size) {
        edit((b) => {
          const uploaded = [...added.values()];
          if (target !== "canvas") {
            const node = b.nodes.find((n) => n.id === target);
            if (!acceptsImageDrop(node?.data))
              throw Error("节点已更改，上传的图片可在素材库找到");
            const { board: withReferences } = addCanvasReferences(b, node, uploaded);
            return { ...withReferences, nodes: withReferences.nodes.map((n) =>
              n.id === target ? { ...n, data: { ...n.data, canvasRef: "" } } : n) };
          }
          if (b.nodes.length + uploaded.length > 250)
            throw Error("画布节点已达上限，上传的图片可在素材库找到");
          const [w, h] = dimensions("image");
          const columns = Math.min(3, uploaded.length);
          const nodes = uploaded.map((asset, i) => makeNode("image", {
            x: point.x - w / 2 + (i % columns) * (w + 28),
            y: point.y - h / 2 + Math.floor(i / columns) * (h + 40),
          }, { assetId: asset.id, title: asset.name.slice(0, 120) }));
          return { ...b, nodes: [...b.nodes, ...nodes] };
        });
        await flush();
      }
      const success = added.size ? "已添加 " + added.size + " 张" + (target === "canvas" ? "图片" : "参考图") : "";
      if (failures.length) {
        const skipped = failures.length > 1 ? failures.length + " 个文件未导入。 " : "";
        notify((success ? success + "。 " : "") + skipped + failures[0]);
      } else if (success) notify(success);
    } catch (e) {
      notify(e.message);
    } finally {
      if (added.size) await refresh().catch((e) => notify(e.message));
      imageUploadActive.current = false;
      setUploadingImages(null);
    }
  }
  function create(kind, at = menu, data = {}) {
    const [w, h] = dimensions(kind),
      r = wrap.current.getBoundingClientRect();
    const point =
      at?.point ||
      screenToFlowPosition({
        x: r.left + box.w * 0.5,
        y: r.top + box.h * 0.39,
      });
    const position = {
      x: point.x - (at?.anchor ? (at.side === "target" ? w : 0) : w / 2),
      y: point.y - h / 2,
    };
    const count = board.nodes.filter((n) => n.data.kind === kind).length;
    const n = makeNode(kind, position, {
      title: kinds[kind] + "节点 " + (count + 1),
      ...data,
    });
    try {
      edit((b) => addCanvasNode(b, n, at?.anchor, at?.side));
    } catch (e) {
      notify(e.message);
      return;
    }
    setMenu(null);
    select(n.id);
    const cx = (position.x + w / 2) * view.zoom + view.x,
      cy = (position.y + h / 2) * view.zoom + view.y;
    if (cx < 120 || cx > box.w - 120 || cy < 100 || cy > box.h - 160)
      setCenter(position.x + w / 2, position.y + h / 2 + 58 / view.zoom, {
        zoom: view.zoom,
        ...motion(),
      });
  }
  function openLinkedMediaTool(source, data) {
    const kind = source.data.kind;
    const [w, h] = dimensions(kind);
    const x = source.position.x + w + 90;
    let y = source.position.y;
    while (
      board.nodes.some(
        (n) =>
          Math.abs(n.position.x - x) < w + 12 &&
          Math.abs(n.position.y - y) < h + 30,
      )
    )
      y += h + 60;
    create(
      kind,
      { anchor: source.id, side: "source", point: { x, y: y + h / 2 } },
      data,
    );
  }
  function openRestoreNode(source, imageModel, workflowValues) {
    openLinkedMediaTool(source, source.data.kind === "video"
      ? { title: "视频放大到 2K", videoModel: videoUpscale2kId } : {
        title: "高清修复",
        imageModel,
        canvasRef: source.id,
        workflowValues,
      });
  }
  function openPoseSwapNode(source) {
    openLinkedMediaTool(source, {
      title: "PoseSwap · 姿势与换装",
      imageModel: poseSwapModelId,
      canvasRatio: "9:16",
      poseSwapRefs: { person: source.id },
    });
  }
  function connect(source, target) {
    if (
      !validCanvasEndpoints(nodeIds, groupMap, source, target) ||
      board.edges.some((e) => e.source === source && e.target === target)
    )
      return;
    if (board.edges.length >= 1000) {
      notify("画布连线已达上限");
      return;
    }
    edit((b) => ({
      ...b,
      edges: [...b.edges, { id: makeId(), source, target }],
    }));
    setMenu(null);
  }
  function unlink(id) {
    edit((b) => ({ ...b, edges: b.edges.filter((e) => e.id !== id) }));
    setEdge("");
  }
  function dockMenu(e) {
    if (menu) {
      setMenu(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(
      r.left,
      r.top - 266,
      "",
      "",
      screenToFlowPosition({
        x: wrap.current.getBoundingClientRect().left + box.w / 2,
        y: wrap.current.getBoundingClientRect().top + box.h * 0.4,
      }),
    );
  }
  const width = Math.min(658, box.w - 16);
  const [nw, nh] = node ? previewDimensions(node.data, assetsById.get(node.data.assetId), imageSizes) : [0, 0];
  const position = node && (dragPositions.get(node.id) || node.position);
  const left = node
    ? view.x + (position.x + nw / 2) * view.zoom - width / 2
    : 0;
  const top = node ? view.y + (position.y + nh) * view.zoom + 12 : 0;
  const marginBottom = box.w < 600 ? 92 : 60;
  const editorAway =
    node &&
    (top < 42 ||
      top + composerHeight > box.h - marginBottom ||
      left < -2 ||
      left + width > box.w + 2);
  function revealEditor() {
    const nextX = clamp(left, 8, box.w - width - 8);
    const nextY = clamp(
      top,
      50,
      Math.max(50, box.h - composerHeight - marginBottom),
    );
    setViewport(
      { x: view.x + nextX - left, y: view.y + nextY - top, zoom: view.zoom },
      motion(),
    );
  }
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const origin = menu?.anchor && nodes.find((n) => n.id === menu.anchor);
  let wire;
  if (origin) {
    const { width: ow, height: oh } = origin,
      right = menu.side === "source";
    wire = getBezierPath({
      sourceX: view.x + (origin.position.x + (right ? ow : 0)) * view.zoom,
      sourceY: view.y + (origin.position.y + oh / 2) * view.zoom,
      sourcePosition: right ? Position.Right : Position.Left,
      targetX: menu.left + (menu.entry === Position.Right ? menu.width : 0),
      targetY: menu.top + 12,
      targetPosition: menu.entry,
    })[0];
  }
  return (
    <div
      ref={wrap}
      style={{ "--comparison-unit": Math.min(3, 1 / view.zoom) + "px", "--tile-tools-scale": Math.min(1, 1 / view.zoom) }}
      className={
        "flow-workspace" +
        (hand ? " hand-mode" : " select-mode") +
        (dragPositions.size ? " moving-node" : "")
      }
      data-image-drop-active={imageDrop === "canvas" || undefined}
      onDragOverCapture={dragImages}
      onDragLeaveCapture={leaveImageDrop}
      onDropCapture={dropImages}
      onDoubleClick={(e) => {
        if (e.target.classList?.contains("react-flow__pane")) panePalette(e);
      }}
    >
      {preview && <AssetPreview asset={preview} assets={assets} projectId={board.id} close={() => setPreview(null)} />}
      <CanvasContext.Provider value={tileContext}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          edgeTypes={edgeTypes}
          connectionLineComponent={ConnectionPreview}
          connectionRadius={28 / view.zoom}
          isValidConnection={({ source, target }) =>
            validCanvasEndpoints(nodeIds, groupMap, source, target) &&
            !board.edges.some((e) => e.source === source && e.target === target)
          }
          nodeTypes={types}
          fitView={fitOnOpen.current}
          fitViewOptions={fitOptions}
          minZoom={minCanvasZoom}
          maxZoom={maxCanvasZoom}
          zoomOnDoubleClick={false}
          connectOnClick={false}
          connectionDragThreshold={3}
          selectionOnDrag={!hand}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode={null}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          panActivationKeyCode={null}
          panOnDrag={hand ? true : [1]}
          onSelectionStart={() => {
            setMenu(null);
            setEdge("");
          }}
          panOnScroll
          nodesDraggable={!hand}
          snapToGrid={snap}
          snapGrid={[16, 16]}
          deleteKeyCode={null}
          onNodeDoubleClick={(_, n) => {
            if (!hand && n.type === "studio") select(n.id);
          }}
          onNodeClick={(e, n) => {
            if (hand || n.type === "assetGroup") return;
            if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
              select(n.id);
              if (e.target.closest('[data-group-image="true"]') && e.target.tagName === "IMG") {
                const asset = n.data.kind === "shot" ? frameAsset(n, board, assets) : assets.find(a => a.id === n.data.assetId);
                if (asset) setPreview(asset.id);
              }
            }
            setEdge("");
            setMenu(null);
          }}
          onPaneClick={() => {
            select("");
            setMenu(null);
            setEdge("");
          }}
          onPaneContextMenu={panePalette}
          onMoveStart={() => setMenu(null)}
          onEdgeClick={(e, edge) => {
            e.stopPropagation();
            select("");
            setEdge(edge.id);
            setMenu(null);
          }}
          onNodesChange={onNodesChange}
          onNodeDragStart={(_, n) => {
            if (!current.current.includes(n.id)) select(n.id);
            setMenu(null);
            setEdge("");
          }}
          onConnect={({ source, target }) => connect(source, target)}
          onConnectStart={(_, s) => {
            setMenu(null);
            select(s.nodeId);
          }}
          onConnectEnd={(e, state) => {
            if (state.isValid || state.toHandle || !state.fromHandle) return;
            const p = e.changedTouches?.[0] || e;
            if (
              !document
                .elementFromPoint(p.clientX, p.clientY)
                ?.classList.contains("react-flow__pane")
            )
              return;
            openMenu(
              p.clientX,
              p.clientY,
              state.fromHandle.nodeId,
              state.fromHandle.type,
            );
          }}
        >
          <Background gap={16} size={0.85} color="#434343" />
          {mini && <MiniMap position="bottom-right" pannable zoomable />}
        </ReactFlow>
      </CanvasContext.Provider>
      <div className="flow-top-left">
        <div className="flow-bar">
          <IconButton label="返回首页" icon={Aperture} onClick={home} />
          <i />
          <button className="flow-title" title="重命名项目" onClick={rename}>
            {board.name}
          </button>
          <IconButton label="打开项目目录" icon={FolderOpen} onClick={() => api("/projects/" + board.id + "/folder", "POST").catch(e => notify(e.message))} />
          <i />
          <button title="剧集设定" onClick={onSeries}>
            画布
            <ChevronDown size={13} />
          </button>
        </div>
        <div className="flow-bar">
          <IconButton
            active
            label="工作流画布"
            icon={Waypoints}
            onClick={() => setMode("canvas")}
          />
          <IconButton
            label="分镜表"
            icon={ListVideo}
            onClick={() => setMode("sheet")}
          />
          <IconButton
            label="分镜台"
            icon={Clapperboard}
            onClick={() => setMode("timeline")}
          />
        </div>
      </div>
      <div className="flow-top-right">
        <span className="flow-status">{status}</span>
        <div className="flow-bar">
          <IconButton
            icon={Cable}
            label="ComfyUI 环境"
            onClick={() => open("environment")}
          />
          <IconButton
            icon={ArrowDownToLine}
            label="下载画布 JSON"
            onClick={download}
          />
          <button onClick={() => open("export")}>
            <Film size={15} />
            导出
          </button>
        </div>
      </div>
      {(imageDrop || uploadingImages) && (
        <div className="flow-image-drop-status" role="status">
          <Upload size={16} />
          {uploadingImages ? "正在上传图片…" : imageDrop === "canvas" ? "松开上传图片" : "松开添加为参考图"}
        </div>
      )}
      {!board.nodes.length && !menu && (
        <div className="flow-empty">
          <p>拖入图片，或双击画布添加创作节点</p>
          <div>
            {["image", "video", "audio", "script", "shot"].map((k) => {
              const Icon = icons[k];
              return (
                <button className="outline" key={k} onClick={() => create(k, null)}>
                  <Icon size={20} />
                  {kinds[k]}
                  {k === "shot" ? "编排" : "节点"}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {node && (
        <div
          className="composer-anchor"
          ref={composer}
          data-image-drop-target={acceptsImageDrop(node.data) ? node.id : undefined}
          data-image-drop-active={imageDrop === node.id || undefined}
          style={{
            width,
            transform: "translate3d(" + left + "px," + top + "px,0)",
          }}
        >
          <NodeComposer
            key={node.id}
            droppingImages={uploadingImages === node.id}
            {...{
              board,
              node,
              assets,
              engine,
              update,
              edit,
              link: connect,
              unlink,
              open,
              onSplit,
              onGenerateShot,
              openRestoreNode,
              openPoseSwapNode,
              onMediaSubmission,
              refresh,
              flush,
              notify,
            }}
          />
        </div>
      )}
      {menu && (
        <>
          {wire && (
            <svg
              className="pending-wire flow-wire-preview"
              data-reverse={menu.side === "target" || undefined}
              aria-hidden="true"
            >
              <path className="flow-wire-track" d={wire} />
              <WireLight path={wire} />
            </svg>
          )}
          <div
            className="flow-palette"
            role="group"
            aria-label="节点类型"
            style={{ left: menu.left, top: menu.top, width: menu.width }}
          >
            <header>
              {menu.anchor
                ? menu.side === "source"
                  ? groupMap.has(menu.anchor)
                    ? "引用资产组生成"
                    : "引用该节点生成"
                  : "为该节点添加输入"
                : "添加节点"}
              <button aria-label="取消建连" onClick={() => setMenu(null)}>
                <X size={13} />
              </button>
            </header>
            {options.map((k) => {
              const Icon = icons[k];
              return (
                <button key={k} onClick={() => create(k)}>
                  <Icon size={16} />
                  {kinds[k]}
                </button>
              );
            })}
          </div>
        </>
      )}
      {deletion?.after === board && (
        <div className="canvas-delete-feedback" role="status">
          已删除所选内容
          <button
            onClick={() => {
              edit(() => deletion.before);
              setDeletion(null);
            }}
          >
            撤销
          </button>
        </div>
      )}
      {chosenEdge && (
        <button className="flow-cut" onClick={() => unlink(chosenEdge)}>
          <Trash2 size={14} />
          断开所选连线
        </button>
      )}
      {editorAway && !menu && !dragPositions.size && (
        <button className="canvas-edit-return" onClick={revealEditor}>
          <PencilLine size={14} />
          定位编辑器
        </button>
      )}
      {(ids.length > 1 || groupMap.has(selected)) && (
        <div className="selection-actions">
          <span>
            {groupMap.get(selected)?.name || "已选 " + ids.length + " 个节点"}
          </span>
          {canGroup && (
            <button onClick={() => changeGroup(false)} title={modifier + "G"}>
              <Group size={15} />
              编组
            </button>
          )}
          {canUngroup && (
            <button
              onClick={() => changeGroup(true)}
              title={modifier + "Shift+G"}
            >
              <Ungroup size={15} />
              取消编组
            </button>
          )}
        </div>
      )}
      {shortcuts && (
        <Modal title="画布快捷键" close={() => setShortcuts(false)}>
          <dl className="canvas-keys">
            {[
              ["框选节点", "在空白处拖动"],
              ["增减选择", "Shift + 单击"],
              ["选择工具", "V"],
              ["抓手工具", "H"],
              ["临时平移", "按住空格并拖动"],
              ["全选节点", modifier + "A"],
              ["编组", modifier + "G"],
              ["取消编组", modifier + "Shift+G"],
              ["编辑组内节点", "单击节点"],
              ["移动资产组", "拖动组标题"],
              ["重命名资产组", "双击组标题"],
              ["删除所选节点、组或连线", "Delete / Backspace"],
              ["清除选择", "Esc"],
            ].map(([name, key]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <kbd>{key}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
      <div className="flow-utilities">
        <IconButton
          label="素材资产"
          icon={Boxes}
          onClick={() => {
            select("");
            open("library");
          }}
        />
        <IconButton
          label="适合屏幕"
          icon={Focus}
          onClick={() => fitView({ ...fitOptions, ...motion() })}
        />
        <IconButton
          label="小地图"
          active={mini}
          icon={MapIcon}
          onClick={() => setMini(!mini)}
        />
        <IconButton
          label="显示连线"
          active={edgesVisible}
          icon={Network}
          onClick={() => showEdges(!edgesVisible)}
        />
        <IconButton
          label="网格吸附"
          icon={Grid2X2}
          active={snap}
          onClick={() => setSnap(!snap)}
        />
        <button
          title="缩小"
          aria-label="缩小"
          disabled={view.zoom <= minCanvasZoom}
          onClick={() => zoomOut(motion())}
        >
          −
        </button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button
          title="放大"
          aria-label="放大"
          disabled={view.zoom >= maxCanvasZoom}
          onClick={() => zoomIn(motion())}
        >
          ＋
        </button>
      </div>
      <div className="flow-dock">
        <button
          className="flow-add"
          title="添加节点"
          aria-label="添加节点"
          onClick={dockMenu}
        >
          <Plus size={22} />
        </button>
        <IconButton
          icon={hand ? Hand : MousePointer2}
          label={pan ? "切换到选择" : "切换到平移"}
          active={hand}
          onClick={() => setPan(!pan)}
        />
        <IconButton
          icon={Layers}
          label="素材库"
          onClick={() => {
            select("");
            open("library");
          }}
        />
        <IconButton
          icon={UserRound}
          label="角色、场景与道具"
          onClick={() => open("cards")}
        />
        <IconButton icon={BookOpen} label="剧集设定" onClick={onSeries} />
        <IconButton
          icon={Activity}
          label="生成历史"
          onClick={() => open("jobs")}
        />
        <i />
        <IconButton
          icon={Film}
          label="预览分镜"
          disabled={!board.order.length}
          onClick={onPreview}
        />
        <IconButton
          icon={Keyboard}
          label="画布快捷键"
          onClick={() => setShortcuts(true)}
        />
        <IconButton
          icon={CircleHelp}
          label="使用指南"
          onClick={() => open("guide")}
        />
      </div>
    </div>
  );
}
