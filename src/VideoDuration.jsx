import React, { useRef, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { h3Fields, h3VideoModelId } from "../shared/h3-video";
import { Panel } from "./GenerationPanels";

const wheelStep = 0.5;
const pixelsPerSecond = 32;

function DurationWheel({
  value,
  min,
  max,
  preview,
  onPreview,
  onCommit,
  compact = false,
}) {
  const drag = useRef(null);
  const [position, setPosition] = useState(null);
  const current = preview ?? value;
  const scale = position ?? current;
  const bounded = (n) => Math.min(max ?? Infinity, Math.max(min, n));
  const pointerValue = (x) => {
    const delta = (drag.current.x - x) / pixelsPerSecond;
    return bounded(
      drag.current.value + Math.round(delta / wheelStep) * wheelStep,
    );
  };
  function cancel() {
    drag.current = null;
    setPosition(null);
    onPreview(null);
  }
  // Only draw graduations around the readout, including for long custom durations.
  const radius = compact ? 2 : 12;
  const marks = Array.from(
    { length: radius * 2 + 1 },
    (_, i) => Math.floor(scale) + i - radius,
  );
  return (
    <div
      className={"duration-wheel" + (compact ? " compact" : "")}
      role="slider"
      tabIndex={0}
      aria-label="视频时长刻度轮"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={current}
      aria-valuetext={`${current} 秒`}
      title="左右拖动调节时长，也可用方向键微调"
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, value };
      }}
      onPointerMove={(e) => {
        if (drag.current?.id === e.pointerId) {
          setPosition(
            bounded(
              drag.current.value +
                (drag.current.x - e.clientX) / pixelsPerSecond,
            ),
          );
          onPreview(pointerValue(e.clientX));
        }
      }}
      onPointerUp={(e) => {
        if (drag.current?.id !== e.pointerId) return;
        const next = pointerValue(e.clientX);
        cancel();
        if (next !== value) onCommit(next);
      }}
      onLostPointerCapture={(e) => {
        if (drag.current?.id === e.pointerId) cancel();
      }}
      onPointerCancel={(e) => {
        if (drag.current?.id === e.pointerId) cancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && drag.current) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
          return;
        }
        const direction = {
          ArrowLeft: -1,
          ArrowDown: -1,
          ArrowRight: 1,
          ArrowUp: 1,
        }[e.key];
        if (!direction || drag.current) return;
        e.preventDefault();
        e.stopPropagation();
        const next = bounded(value + direction * wheelStep);
        if (next !== value) onCommit(next);
      }}
    >
      <div className="duration-wheel-track" aria-hidden="true">
        {marks.map((n, i) => (
          <span
            key={i}
            style={{ left: `calc(50% + ${(n - scale) * pixelsPerSecond}px)` }}
          >
            {n >= min && (max == null || n <= max) && <i>{compact ? "" : n}</i>}
            {n + wheelStep >= min && (max == null || n + wheelStep <= max) && (
              <b />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function VideoDuration({ model, data, set, fieldKey, label = "视频时长" }) {
  const anchor = useRef(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const durationKey =
    fieldKey || model.durationKey || (model.id === h3VideoModelId && h3Fields.duration);
  const field =
    durationKey &&
    model.fields.find(
      (f) => f.key === durationKey && model.controls.includes(f.key),
    );
  if (!field && !model.native && !model.canDuration) return null;

  const min = field ? Math.max(0, field.min ?? 0) : 1;
  const max = field ? field.max : model.native ? 5 : 30;
  const seconds = field
    ? (data.workflowValues?.[field.key] ?? field.value)
    : Math.min(data.duration ?? 3, max);
  const valid = (n) =>
    Number.isFinite(n) && n > 0 && n >= min && (max == null || n <= max);
  const presets = (model.native ? [1, 2, 3, 5] : [3, 5, 8, 10]).filter(valid);
  const wheelValue =
    draft !== null && valid(Number(draft)) ? Number(draft) : seconds;
  const wheelProps = {
    value: wheelValue,
    min: min || Math.min(wheelStep, wheelValue),
    max,
    preview,
    onPreview: setPreview,
  };
  function close() {
    setDraft(null);
    setPreview(null);
  }
  const apply = (n) => {
    if (!valid(n)) return;
    set(
      field
        ? { workflowValues: { ...data.workflowValues, [field.key]: n } }
        : { duration: n },
    );
    close();
  };
  return (
    <>
      <div className="duration-control">
        <DurationWheel
          {...wheelProps}
          value={seconds}
          preview={draft === null ? preview : null}
          compact
          onCommit={apply}
        />
        <button
          type="button"
          ref={anchor}
          className="video-duration-trigger"
          aria-label={`${label}，${draft === null ? (preview ?? seconds) : seconds} 秒`}
          aria-haspopup="dialog"
          aria-expanded={draft !== null}
          onClick={() => setDraft(String(seconds))}
        >
          <span>{draft === null ? (preview ?? seconds) : seconds} 秒</span>
          <ChevronDown size={12} />
        </button>
      </div>
      {draft !== null && (
        <Panel anchor={anchor} close={close} title={label} icon={Clock3}>
          <div className="duration-body">
            <DurationWheel
              {...wheelProps}
              onCommit={(n) => setDraft(String(n))}
            />
            <div
              className="duration-presets"
              role="group"
              aria-label="常用时长"
            >
              {presets.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={n === seconds}
                  onClick={() => apply(n)}
                >
                  {n} 秒
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                apply(Number(draft));
              }}
            >
              <label>
                自定义时长
                <span className="duration-input">
                  <input
                    aria-label="自定义时长（秒）"
                    type="number"
                    step="any"
                    min={min}
                    max={max}
                    required
                    value={preview ?? draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <span>秒</span>
                </span>
              </label>
              <button
                className="solid panel-primary"
                disabled={!valid(Number(draft))}
              >
                应用
              </button>
            </form>
            {draft !== "" && !valid(Number(draft)) && (
              <small className="panel-warning" role="status">
                {Number(draft) <= 0
                  ? "时长须大于 0 秒"
                  : Number(draft) < min
                    ? `最短 ${min} 秒`
                    : `最长 ${max} 秒`}
              </small>
            )}
          </div>
        </Panel>
      )}
    </>
  );
}
