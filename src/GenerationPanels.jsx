import { JobTiming } from "./JobTiming";
import { Select } from "./Select";
import { outputSize, sizeError } from "../shared/generation-size";
import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Columns2,
  History,
  Image as ImageIcon,
  LoaderCircle,
  RectangleHorizontal,
  RectangleVertical,
  Settings2,
  Upload,
  ScanLine,
  X,
  Zap,
} from "lucide-react";
import { refLabel } from "./canvasReferences";
import { ratios } from "../shared/series";
import { h3ContinuationFields, h3ContinuationModelId, h3Fields, h3VideoModelId } from "../shared/h3-video";
import { poseSwapModelId } from "../shared/pose-swap";
import { WorkflowFields } from "./WorkflowSettings";
import { Media } from "./ui";
import { AssetFileActions } from "./AssetFileActions";
import "./generation-panels.css";

export function Panel({
  title,
  subtitle,
  icon: Icon,
  anchor,
  close,
  children,
  actions,
}) {
  const dialog = useRef(null);
  const heading = useId();
  useLayoutEffect(() => {
    const el = dialog.current;
    el.showModal();
    const place = () => {
      if (!anchor?.current) return;
      const r = anchor.current.getBoundingClientRect();
      const { width, height } = el.getBoundingClientRect();
      const top = r.top - height - 8;
      el.style.left =
        Math.max(10, Math.min(r.left, window.innerWidth - width - 10)) + "px";
      el.style.top =
        Math.max(
          10,
          Math.min(
            top >= 10 ? top : r.bottom + 8,
            window.innerHeight - height - 10,
          ),
        ) + "px";
    };
    place();
    const observer = new ResizeObserver(place);
    if (anchor) observer.observe(el);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      el.close();
    };
  }, [anchor]);

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={heading}
      className={
        "generation-dialog " + (anchor ? "settings-dialog" : "history-dialog")
      }
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="generation-panel">
        <div className="generation-heading">
          <span className="generation-icon">
            <Icon size={18} />
          </span>
          <div>
            <h2 id={heading}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="panel-close"
            aria-label="关闭"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {children}
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
    </dialog>,
    document.body,
  );
}

const h3Options = [
  {
    key: h3Fields.fast,
    label: "生成模式",
    choices: [
      [true, "快速", "4 步", Zap],
      [false, "高清", "8 步", ScanLine],
    ],
  },
  {
    key: h3Fields.landscape,
    label: "画面方向",
    choices: [
      [true, "横屏", "16:9", RectangleHorizontal],
      [false, "竖屏", "9:16", RectangleVertical],
    ],
  },
];

const wideImageSizes = [[1280, 720], [1536, 864], [1920, 1080], [2048, 1152], [2560, 1440]];
const squareImageSizes = [[768, 768], [1024, 1024], [1536, 1536], [2048, 2048], [2560, 2560]];
const sameSize = (a, b) => a[0] === b[0] && a[1] === b[1];
function imageSizeOptions(ratio) {
  const extras = ratio === "1:1" ? squareImageSizes : wideImageSizes;
  return [ratios[ratio].image, ...extras.map((size) => ratio === "9:16" ? [...size].reverse() : size)];
}

export function GenerationSettings({
  anchor,
  close,
  kind,
  data,
  set,
  model,
  ratio,
  resolved,
  inputs,
  editPrompt,
  uploadReferences,
  chooseCanvas,
  busy,
  error,
  maxSide,
  limits,
}) {
  const image = kind === "image";
  const workflow = model?.workflow;
  const h3 = model?.family === "h3" || model?.id === h3VideoModelId;
  const continuingVideo = model?.id === h3ContinuationModelId;
  const swapping = model?.id === poseSwapModelId;
  const fields = workflow
    ? model.fields.filter(
        (f) =>
          (!model.controls || model.controls.includes(f.key)) &&
          f.key !== model.durationKey &&
          !(continuingVideo && [h3ContinuationFields.secondPrompt, h3ContinuationFields.secondDuration].includes(f.key)) &&
          !(h3 && Object.values(h3Fields).includes(f.key)),
      )
    : [];
  const canSize = kind !== "audio" && (!workflow || swapping) && model?.canSize !== false;
  const [custom, setCustom] = useState(!!data.customSize);
  const [refKind, setRefKind] = useState("image");
  const pickFiles = useRef(null);
  const types = { image: "图片", video: "视频", audio: "音频" };
  const referenceKinds = ["image", "video", "audio"].filter((type) =>
    type === "image" ? model?.maxRefs : model?.optionalMedia?.[type]);
  const mixed = !!Object.keys(model?.optionalMedia || {}).length;
  const mediaGroup = mixed && resolved.mediaReferences?.[refKind];
  const initial = canSize ? outputSize(kind, ratio, data.customSize) : [];
  const [width, setWidth] = useState(initial[0]),
    [height, setHeight] = useState(initial[1]);
  const draft = [Number(width), Number(height)];
  const hasDimensions = draft.every((n) => n > 0);
  const presetAspect = hasDimensions
    ? draft[0] === draft[1] ? "1:1" : draft[0] > draft[1] ? "16:9" : "9:16"
    : ratio;
  const [aspectWidth, aspectHeight] = ratios[presetAspect].image;
  const matchedAspect = hasDimensions && draft[0] * aspectHeight === draft[1] * aspectWidth
    ? presetAspect
    : null;
  const imageSizes = image && canSize ? imageSizeOptions(presetAspect) : [];
  const invalidSize = canSize && (image || custom) && sizeError(draft, maxSide, limits);
  function chooseSize([w, h]) {
    setWidth(w);
    setHeight(h);
  }
  function chooseImageAspect(key) {
    if (key === matchedAspect) return;
    const next = imageSizeOptions(key);
    const valid = (size) => !sizeError(size, maxSide, limits);
    const sameLongSide = next.find((size) => Math.max(...size) === Math.max(...draft) && valid(size));
    chooseSize(sameLongSide || next.find(valid) || next[0]);
  }
  function done() {
    if (canSize && image) {
      const canvasRatio = presetAspect;
      const customSize = sameSize(draft, ratios[canvasRatio].image)
        ? null
        : { width: draft[0], height: draft[1] };
      set({ canvasRatio, customSize });
    } else if (canSize && custom) {
      set({ customSize: { width: draft[0], height: draft[1] } });
    }
    close();
  }

  const mentioned = /@图\d+/u.test(data.text);
  const refs = resolved.refs;
  const chosen = data.canvasRef || "";
  const selected = resolved.selected;
  const max =
    image || workflow
      ? (model?.maxRefs ?? (model?.reference ? 1 : 0))
      : model?.needsImage
        ? 1
        : 0;
  const multi = kind === "video" && max > 1;
  const promptNumbers = new Set(Array.from(data.text.matchAll(/@图(\d+)/gu), (m) => Number(m[1])));
  function toggleRef(ref, used) {
    const ids = selected
      .filter((item) => item.id !== ref.id && !promptNumbers.has(item.number))
      .map((item) => item.id);
    if (!used) ids.push(ref.id);
    set({ canvasRef: "", canvasRefIds: ids });
  }
  function selectMedia(ids) {
    set({ selectedMediaRefs: { ...data.selectedMediaRefs, [refKind]: ids } });
  }
  const missingVae = data.imageVae && !model?.vaes?.includes(data.imageVae);
  return (
    <Panel
      anchor={anchor}
      close={close}
      icon={Settings2}
      title={{ image: "图片", video: "视频", audio: "音频" }[kind] + "生成设置"}
      actions={
        <>
          <span>更改会用于下次生成</span>
          <button
            className="solid panel-primary"
            disabled={!!invalidSize}
            onClick={done}
          >
            完成
          </button>
        </>
      }
    >
      <div className="settings-body">
        {mixed && (
          <section className="mixed-refs">
            <div role="group" aria-label="参考素材类型" className="reference-types">
              {referenceKinds.map((type) => (
                <button key={type} aria-pressed={type === refKind} onClick={() => setRefKind(type)}>
                  {types[type]} <span>{resolved.media[type].length}/{model.mediaSlots[type]}</span>
                </button>
              ))}
            </div>
            <div className="reference-actions">
              <button disabled={busy} onClick={() => pickFiles.current.click()}><Upload size={14} />上传{types[refKind]}</button>
              <button onClick={chooseCanvas}>从画布连接</button>
              <input key={refKind} ref={pickFiles} type="file" multiple hidden accept={refKind + "/*"}
                onChange={(e) => {
                  const files = Array.from(e.target.files);
                  e.target.value = "";
                  uploadReferences(files, refKind);
                }} />
            </div>
            {error && <p className="panel-warning" role="alert">{error}</p>}
            {mediaGroup && (
              <div className="setting-group">
                <div className="group-title">
                  <h3>参考{types[refKind]}</h3><span>已选 {mediaGroup.selected.length} / {model.mediaSlots[refKind]} 段</span>
                </div>
                <p className="panel-note">{refKind === "video"
                  ? "可选，用来参考动作与运镜。读取开头最多 15 秒的画面，自动转为 24 帧/秒。"
                  : "可选，用来参考人声、音色或环境声。"}</p>
                {mediaGroup.candidates.length > 0 && <div className="setting-refs">
                  {mediaGroup.candidates.map((r) => {
                    const used = mediaGroup.selected.some((v) => v.id === r.id);
                    const pinned = mediaGroup.tokens.includes(r.number);
                    const label = refLabel(refKind, r.number);
                    return <button key={r.id} className="setting-ref" data-used={used}
                      aria-label={label + " " + r.title} aria-pressed={used}
                      disabled={pinned || (!used && mediaGroup.selected.length >= model.mediaSlots[refKind])}
                      onClick={() => {
                        const ids = mediaGroup.selected.filter((v) => v.id !== r.id && !mediaGroup.tokens.includes(v.number)).map((v) => v.id);
                        selectMedia(used ? ids : [...ids, r.id]);
                      }}>
                      <Media asset={r.asset} /><span><b>{label}{pinned ? " · @" : ""}</b><small>{r.title}</small></span>
                      {used && <Check size={15} />}
                    </button>;
                  })}
                </div>}
                {(mediaGroup.candidates.length > 0 || data.selectedMediaRefs?.[refKind]) && (
                  <div className="source-options">
                    <button onClick={() => selectMedia([])}>清除勾选</button>
                    {mediaGroup.tokens.length > 0 && <button onClick={editPrompt}>编辑 @ 引用</button>}
                  </div>
                )}
                {resolved.error && <p role="alert" className="panel-warning">{resolved.error}</p>}
              </div>
            )}
          </section>
        )}
        {canSize && (
          <div className="setting-group">
            <div className="group-title">
              <h3>画幅</h3>
              <span>
                {(image || custom ? [width || "–", height || "–"] : ratios[ratio][kind]).join(" × ")} 像素
              </span>
            </div>
            <div className={"ratio-options" + (image ? " image-ratio-options" : "")} role="group" aria-label="画幅">
              {Object.entries(ratios).map(([key, sizes]) => {
                const [w, h] = sizes[kind];
                const name = w === h ? "方形" : w > h ? "横屏" : "竖屏";
                return (
                  <button
                    key={key}
                    aria-pressed={image ? matchedAspect === key : !custom && ratio === key}
                    onClick={() => {
                      if (image) chooseImageAspect(key);
                      else {
                        setCustom(false);
                        set({ canvasRatio: key, customSize: null });
                      }
                    }}
                  >
                    <i
                      aria-hidden="true"
                      style={{
                        width: (27 * w) / Math.max(w, h),
                        height: (27 * h) / Math.max(w, h),
                      }}
                    />
                    <span>
                      {name} <b>{key}</b>
                    </span>
                  </button>
                );
              })}
              {!image && <button
                aria-pressed={custom}
                onClick={() => {
                  if (!custom) {
                    const [w, h] = ratios[ratio][kind];
                    setWidth(w);
                    setHeight(h);
                    setCustom(true);
                  }
                }}
              >
                <i style={{ width: 22, height: 17, borderStyle: "dashed" }} />
                <span>自定义</span>
              </button>}
            </div>
            {image && (
              <div className="setting-group image-resolution">
                <div className="group-title"><h3>分辨率</h3></div>
                <div className="image-size-presets" role="group" aria-label="预设分辨率">
                  {imageSizes.map((size) => {
                    const title = size.join(" × ");
                    const unavailable = sizeError(size, maxSide, limits);
                    return <button key={title} type="button" aria-pressed={sameSize(draft, size)}
                      title={unavailable || undefined} disabled={!!unavailable} onClick={() => chooseSize(size)}>
                      {title}
                    </button>;
                  })}
                </div>
              </div>
            )}
            {(image || custom) && (
              <div className="size-editor">
                <label>
                  {image ? "宽度（px）" : "宽度"}
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="宽度"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </label>
                <span>×</span>
                <label>
                  {image ? "高度（px）" : "高度"}
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="高度"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </label>
              </div>
            )}
            {!image && custom && (
              <small className="panel-note">
                环境最长边 {maxSide} 像素，可在「ComfyUI 环境」调整。
              </small>
            )}
            {invalidSize && (
              <small role="alert" className="panel-warning">
                {invalidSize}
              </small>
            )}
          </div>
        )}
        {!swapping && (!mixed || refKind === "image") && (max > 0 || refs.length > 0 || chosen || mentioned) && (
          <div className="setting-group">
            <div className="group-title">
              <h3>{image || workflow ? "生成时参考哪些图" : "起始画面"}</h3>
              {max > 0 && (
                <span>
                  {multi ? "已选 " + selected.length + " / " + max + " 张"
                    : image || workflow ? "最多 " + max + " 张" : "选用 1 张"}
                </span>
              )}
            </div>
            {multi && refs.length > 0 ? (
              <div className="source-options" role="group" aria-label="参考图来源">
                <button aria-pressed={!chosen && !Array.isArray(data.canvasRefIds)}
                  onClick={() => set({ canvasRef: "", canvasRefIds: undefined })}>自动选择</button>
                <button onClick={() => set({ canvasRef: "", canvasRefIds: [] })}>
                  清除勾选
                </button>
                {mentioned && <button onClick={editPrompt}>编辑 @ 引用</button>}
              </div>
            ) : mentioned ? (
              <div className="mention-mode">
                <strong>按提示词中的 @ 引用</strong>
                <button onClick={editPrompt}>编辑提示词</button>
              </div>
            ) : refs.length > 0 || chosen || inputs.awaitingImage ? (
              <div
                className="source-options"
                role="group"
                aria-label="参考图来源"
              >
                <button
                  aria-pressed={chosen === ""}
                  onClick={() => set({ canvasRef: "" })}
                >
                  {image ? "全部参考图" : "自动选择"}
                </button>
                <button
                  aria-pressed={chosen === "none"}
                  onClick={() => set({ canvasRef: "none" })}
                >
                  仅用文字
                </button>
              </div>
            ) : (
              <p className="panel-note">
                上传图片或连接上游图片节点后，就可以在这里选图。
              </p>
            )}
            {refs.length > 0 && (
              <div className="setting-refs">
                {refs.map((r) => {
                  const used = selected.some((s) => s.id === r.id);
                  const pinned = multi && promptNumbers.has(r.number) && chosen !== "none";
                  const role = model?.framePair && used &&
                    (selected[0]?.id === r.id ? "首帧" : "尾帧");
                  const label = refLabel("image", r.number);
                  const inside = (
                    <>
                      <img src={r.asset.url} alt="" />
                      <span>
                        <b>{label}{role ? " · " + role : ""}{pinned ? " · @" : ""}</b>
                        {multi && <small title={r.title}>{r.title}</small>}
                      </span>
                      {used && <Check size={15} aria-label="本次使用" />}
                    </>
                  );
                  return mentioned && !multi ? (
                    <div key={r.id} className="setting-ref" data-used={used}>
                      {inside}
                    </div>
                  ) : (
                    <button
                      key={r.id}
                      className="setting-ref"
                      data-used={used}
                      aria-label={multi ? label + " " + r.title : "只用" + label}
                      aria-pressed={multi ? used : chosen === r.id}
                      disabled={multi && (pinned || (!used && selected.length >= max))}
                      onClick={() => multi ? toggleRef(r, used) : set({ canvasRef: r.id })}
                    >
                      {inside}
                    </button>
                  );
                })}
              </div>
            )}
            {(multi || !mentioned) && refs.length > 1 && (
              <p className="panel-note">
                {multi
                  ? model.framePair
                    ? "第一张用作首帧，第二张用作尾帧。"
                    : "点击缩略图可多选。带 @ 的图片已在提示词中引用。"
                  : image
                  ? "点缩略图可单独使用，输入 @ 可指定多张。"
                  : continuingVideo
                    ? "点缩略图指定两段共用的参考图。"
                    : "点击缩略图可指定视频的起始画面。"}
              </p>
            )}
            {resolved.error && (
              <p className="panel-warning" role="alert">
                {resolved.error}
                {mentioned && chosen === "none" && (
                  <button onClick={() => set({ canvasRef: "" })}>
                    启用参考图
                  </button>
                )}
              </p>
            )}
          </div>
        )}
        {h3 &&
          h3Options.filter(({ key }) => !model.fixedSamplingSteps || key !== h3Fields.fast).map(({ key, label, choices }) => {
            const field = model.fields.find((f) => f.key === key);
            if (!field || !model.controls?.includes(key)) return null;
            const current = data.workflowValues?.[key] ?? field.value;
            return (
              <fieldset className="video-option-group" key={key}>
                <legend>{label}</legend>
                <div>
                  {choices.map(([value, name, detail, Icon]) => (
                    <label key={name}>
                      <input
                        type="radio"
                        name={key}
                        checked={current === value}
                        onChange={() =>
                          set({
                            workflowValues: {
                              ...data.workflowValues,
                              [key]: value,
                            },
                          })
                        }
                      />
                      <span>
                        <Icon size={15} />
                        {name}
                        <small>
                          {key === h3Fields.landscape && model.outputSize
                            ? value
                              ? model.outputSize.join("×")
                              : [...model.outputSize].reverse().join("×")
                            : detail}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        {fields.length > 0 && (
          <div className="workflow-setting">
            <WorkflowFields fields={fields} data={data} set={set} />
          </div>
        )}
        <details className="advanced-setting" open={missingVae || undefined}>
          <summary>
            <Settings2 size={15} />
            高级设置
            <ChevronDown size={15} />
          </summary>
          {image && (model?.vaes?.length > 0 || missingVae) && (
            <label>
              图像解码器（VAE）
              <Select
                aria-label="图像解码器（VAE）"
                value={data.imageVae || model?.vae || ""}
                onValueChange={(next) => set({ imageVae: next })}
              >
                {missingVae && (
                  <option disabled value={data.imageVae}>
                    原解码器已缺失，请重新选择
                  </option>
                )}
                {model?.vaes?.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </label>
          )}
          <details className="submitted-prompt">
            <summary>查看完整提示词</summary>
            <pre>{resolved.prompt}</pre>
          </details>
        </details>
      </div>
    </Panel>
  );
}

const jobDate = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function jobTime(job) {
  return jobDate.format(new Date(job.created));
}

export function GenerationHistory({ jobs, assets, data, projectId, close, apply }) {
  const [selection, select] = useState(jobs[0]?.id);
  const [compare, setCompare] = useState(false);
  const job = jobs.find((j) => j.id === selection) || jobs[0];
  if (!job) return null;
  const byId = new Map(assets.map((a) => [a.id, a]));
  const preview = byId.get(job.assetId);
  const current = byId.get(data.assetId);
  const inUse = !!preview && current?.id === preview.id;
  const canCompare = !!current && !!preview && !inUse;
  const comparing = compare && canCompare;
  return (
    <Panel
      close={close}
      icon={History}
      title="生成记录"
      subtitle={data.title}
      actions={
        <>
          <span>
            {inUse
              ? "此版本正在画布上使用"
              : job.status === "done" && preview
                ? "选用后，会更新这个节点的画面"
                : ""}
          </span>
          <button
            className="solid panel-primary"
            disabled={!preview || inUse || job.status !== "done"}
            onClick={() => apply(preview.id)}
          >
            <Check size={15} />
            {inUse ? "当前版本" : "使用这个版本"}
          </button>
        </>
      }
    >
      <div className="history-content">
        <div className="history-stage">
          <div className="group-title">
            <h3>{comparing ? "版本对比" : "版本预览"}</h3>
            {canCompare && (
              <button
                className="compare-toggle"
                aria-pressed={comparing}
                onClick={() => setCompare(!compare)}
              >
                <Columns2 size={14} />
                {comparing ? "退出对比" : "对比当前版本"}
              </button>
            )}
          </div>
          <div className="history-preview" data-compare={comparing}>
            {comparing && (
              <figure>
                <Media key={current.id} asset={current} controls />
                <figcaption>画布当前版本</figcaption>
              </figure>
            )}
            {preview && job.status === "done" ? (
              <figure>
                <Media key={preview.id} asset={preview} controls />
                {comparing && <figcaption>选中的版本</figcaption>}
              </figure>
            ) : (
              <div className="preview-empty">
                {job.status === "running" ? (
                  <LoaderCircle size={25} className="generation-spin" />
                ) : (
                  <CircleAlert size={25} />
                )}
                <strong>
                  {job.status === "running"
                    ? (job.phase === "waiting" ? "排队中" : "正在生成")
                    : job.status === "cancelled" ? "已取消生成"
                    : job.status === "failed"
                      ? "本次生成失败"
                      : "预览素材暂不可用"}
                </strong>
                {["running", "failed"].includes(job.status) && <p>{job.detail}</p>}
              </div>
            )}
          </div>
          <JobTiming job={job} />
          {preview && job.status === "done" && <AssetFileActions key={preview.id} asset={preview} projectId={projectId} />}
        </div>
        <div className="history-list">
          <h3>
            最近记录 <span>{jobs.length}</span>
          </h3>
          <div role="group" aria-label="选择预览版本">
            {jobs.map((j, i) => {
              const asset = byId.get(j.assetId),
                used = !!asset && asset.id === data.assetId;
              const caption =
                j.status === "running"
                  ? (j.phase === "waiting" ? "排队中" : "生成中")
                  : j.status === "cancelled" ? "已取消"
                  : j.status === "failed"
                    ? "生成失败"
                    : i === 0
                      ? "最新生成"
                      : "历史版本";
              return (
                <button
                  className="version-option"
                  key={j.id}
                  aria-pressed={job.id === j.id}
                  onClick={() => select(j.id)}
                >
                  <span className="version-thumb">
                    {asset ? <Media asset={asset} /> : <ImageIcon size={17} />}
                  </span>
                  <span className="version-caption">
                    <strong>{caption}</strong>
                    <time dateTime={j.created}>{jobTime(j)}</time>
                  </span>
                  {used && (
                    <span className="in-use" title="画布当前版本">
                      <Check size={11} />
                      在用
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}
