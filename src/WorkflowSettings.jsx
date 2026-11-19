import { Select } from "./Select";
import React, { useState } from "react";
import { api } from "./client";
import { Modal } from "./ui";
export function WorkflowImport({ close, notify, onSaved }) {
  const [verbatim, setVerbatim] = useState(false);
  const [mentionPattern, setPattern] = useState("图{n}");
  const [styleSource, pickSource] = useState(""),
    [styleFiles, pickFiles] = useState([]);
  const [videos, setVideos] = useState([]),
    [audios, setAudios] = useState([]),
    [kind, setKind] = useState("image");
  const [patterns, setPatterns] = useState({
      video: "视频{n}",
      audio: "语音{n}",
    }),
    [controls, setControls] = useState([]);
  const [file, setFile] = useState(null),
    [info, setInfo] = useState(null),
    [name, setName] = useState(""),
    [prompt, setPrompt] = useState(""),
    [output, setOutput] = useState(""),
    [images, setImages] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(f) {
    if (!f) return;
    setBusy(true);
    setError("");
    setInfo(null);
    try {
      if (f.size > 3500000) throw Error("请选择小于 3.5 MB 的工作流");
      const graph = JSON.parse(await f.text()),
        i = await api("/workflows/inspect", "POST", { graph });
      const texts = i.fields.filter((f) => f.type === "STRING");
      pickSource("");
      pickFiles([]);
      setPattern(
        texts.some((f) => /<Picture \d+>/i.test(f.value))
          ? "<Picture {n}>"
          : texts.some(
                (f) =>
                  typeof f.value === "string" && /<image\d+>/.test(f.value),
              )
            ? "<image{n}>"
            : "图{n}",
      );
      setFile(graph);
      setName(f.name.replace(/\.json$/i, "").slice(0, 100));
      setInfo(i);
      setPrompt(
        (
          texts.find(
            (f) =>
              /提示词|prompt/i.test(f.title) && !/negative|负面/i.test(f.title),
          ) ||
          texts.find(
            (f) =>
              /^(prompt|text|positive_prompt)$/i.test(f.input) &&
              !/negative|负面/i.test(f.title),
          ) ||
          texts.find(
            (f) =>
              f.input === "value" &&
              !/路径|名称|文件|folder|path|prefix/i.test(f.title),
          )
        )?.key || "",
      );
      const chosen =
        i.outputs.find((o) => /最终输出|最终.*成片/.test(o.title)) ||
        i.outputs.at(-1);
      setOutput(chosen?.id || "");
      setKind(chosen?.kind || "image");
      setImages(
        i.images.filter((f) => !/蒙版|mask/i.test(f.title)).map((f) => f.key),
      );
      setVerbatim(false);
      setVideos(i.videos.map((f) => f.key));
      setAudios(i.audios.map((f) => f.key));
      setControls([]);
      setPatterns({ video: "视频{n}", audio: "语音{n}" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api("/workflows", "POST", {
        graph: file,
        environment: info.environment,
        name,
        bindings: {
          prompt,
          ...(kind === "audio" &&
            prompt &&
            verbatim && { verbatim: true, promptLabel: "旁白台词" }),
          kind,
          videos,
          audios,
          controls: controls.filter(
            (key) => ![prompt, ...images, ...audios, ...videos].includes(key),
          ),
          mentionPatterns: patterns,
          output,
          images,
          styleSource,
          styleFiles,
          mentionPattern,
        },
      });
      onSaved(id, kind, images.length);
      notify("已添加预设工作流 · " + name);
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="导入预设工作流" close={close}>
      <form className="env-form" onSubmit={save}>
        <label>
          ComfyUI 流程图或 API 工作流 JSON
          <input
            aria-label="工作流 JSON 文件"
            type="file"
            accept=".json"
            disabled={busy}
            onChange={(e) => load(e.target.files[0])}
          />
        </label>
        {info && (
          <>
            <label>
              预设名称
              <input
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label>
              画布提示词写入
              <Select value={prompt} onValueChange={(next) => setPrompt(next)}>
                <option value="">使用工作流原文（无需填写提示词）</option>
                {info.fields
                  .filter((f) => f.type === "STRING")
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      #{f.id} {f.title}
                    </option>
                  ))}
              </Select>
            </label>
            {kind === "audio" && prompt && (
              <label className="speech-mode">
                <input
                  type="checkbox"
                  checked={verbatim}
                  onChange={(e) => setVerbatim(e.target.checked)}
                />
                按原文朗读台词
              </label>
            )}
            <label>
              采用此节点的生成结果
              <Select
                value={output}
                onValueChange={(next) => {
                  setOutput(next);
                  setKind(info.outputs.find((o) => o.id === next).kind);
                }}
              >
                {info.outputs.map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.id} {o.title}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              结果类型
              <Select value={kind} onValueChange={(next) => setKind(next)}>
                {Object.entries({
                  image: "图片",
                  video: "视频",
                  audio: "音频",
                }).map(([k, n]) => (
                  <option value={k} key={k}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
            {info.modelOutputs.length > 0 && info.loras.length > 0 && (
              <details>
                <summary>绑定可选 LoRA 风格</summary>
                <label>
                  插入到模型输出
                  <Select
                    value={styleSource}
                    onValueChange={(next) => pickSource(next)}
                  >
                    <option value="">使用原工作流</option>
                    {info.modelOutputs.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.title}
                      </option>
                    ))}
                  </Select>
                </label>
                {styleSource && (
                  <label>
                    选择已确认兼容的 LoRA
                    <Select
                      multiple

                      value={styleFiles}
                      onValueChange={(next) => pickFiles(next)}
                    >
                      {info.loras.map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </Select>
                  </label>
                )}
              </details>
            )}
            <fieldset className="slot-bindings">
              <legend>需要用户提供的素材</legend>
              {[
                [images, setImages, "图片", info.images],
                [videos, setVideos, "视频", info.videos],
                [audios, setAudios, "音频", info.audios],
              ].map(([slots, setSlots, label, detected]) => (
                <div key={label}>
                  <strong>{label}输入</strong>
                  {slots.map((key, i) => (
                    <div key={key}>
                      <span>
                        {label}
                        {i + 1} ·{" "}
                        {info.fileInputs.find((f) => f.key === key)?.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSlots(slots.filter((k) => k !== key))}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                  <Select
                    aria-label={"添加" + label + "输入"}
                    value=""
                    onValueChange={(next) => setSlots([...slots, next])}
                  >
                    <option value="">添加输入节点…</option>
                    {[
                      ...detected,
                      ...info.fileInputs.filter(
                        (f) => !detected.some((d) => d.key === f.key),
                      ),
                    ]
                      .filter(
                        (f) =>
                          ![...images, ...videos, ...audios, prompt].includes(
                            f.key,
                          ),
                      )
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          #{f.id} {f.title}
                        </option>
                      ))}
                  </Select>
                  {slots.length > 0 && (
                    <label>
                      提示词引用格式
                      <input
                        required
                        pattern=".*\{n\}.*"
                        value={
                          label === "图片"
                            ? mentionPattern
                            : patterns[label === "视频" ? "video" : "audio"]
                        }
                        onChange={(e) =>
                          label === "图片"
                            ? setPattern(e.target.value)
                            : setPatterns({
                                ...patterns,
                                [label === "视频" ? "video" : "audio"]:
                                  e.target.value,
                              })
                        }
                      />
                    </label>
                  )}
                </div>
              ))}
            </fieldset>
            <details>
              <summary>选择用户可调整的参数</summary>
              <div className="import-fields">
                {info.fields
                  .filter(
                    (f) =>
                      ![prompt, ...images, ...videos, ...audios].includes(
                        f.key,
                      ) && !["seed", "noise_seed"].includes(f.input),
                  )
                  .map((f) => (
                    <label key={f.key}>
                      <input
                        type="checkbox"
                        checked={controls.includes(f.key)}
                        onChange={(e) =>
                          setControls(
                            e.target.checked
                              ? [...controls, f.key]
                              : controls.filter((k) => k !== f.key),
                          )
                        }
                      />
                      {f.title}
                    </label>
                  ))}
              </div>
            </details>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className="solid"
          disabled={!name.trim() || !output || !info || busy}
        >
          {busy ? "读取中…" : "保存到当前环境"}
        </button>
      </form>
    </Modal>
  );
}
export function WorkflowFields({ fields, data, set }) {
  const values = data.workflowValues || {};
  const change = (key, value) =>
    set({ workflowValues: { ...values, [key]: value } });
  return (
    <details open>
      <summary>工作流参数</summary>
      <div className="workflow-fields">
        {fields.map((f) => {
          const value = values[f.key] ?? f.value;
          return (
            <label key={f.key} title={"#" + f.id + " " + f.title}>
              {f.title}
              {f.type === "choice" ? (
                <Select
                  value={JSON.stringify(value)}
                  onValueChange={(next) => change(f.key, JSON.parse(next))}
                >
                  {!f.choices.includes(value) && (
                    <option value={JSON.stringify(value)}>
                      已缺失 · {String(value)}
                    </option>
                  )}
                  {f.choices.map((v, i) => (
                    <option key={i} value={JSON.stringify(v)}>
                      {String(v)}
                    </option>
                  ))}
                </Select>
              ) : f.type === "BOOLEAN" ? (
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => change(f.key, e.target.checked)}
                />
              ) : f.type === "STRING" ? (
                <input
                  value={value}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              ) : (
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step || (f.type === "INT" ? 1 : "any")}
                  value={value}
                  onChange={(e) => {
                    if (e.target.value !== "")
                      change(f.key, Number(e.target.value));
                  }}
                />
              )}
            </label>
          );
        })}
      </div>
    </details>
  );
}
