import { Select } from "./Select";
import { workflowNeeds } from "../shared/canvas";
import { h3VideoModelId } from "../shared/h3-video";
import React, { useRef, useState } from "react";
import {
  Boxes,
  Check,
  ChevronDown,
  FileUp,
  FolderCog,
  Search,
  Workflow,
} from "lucide-react";
import { Panel } from "./GenerationPanels";
import { WorkflowImport } from "./WorkflowSettings";
import { environmentEvent } from "./EnvironmentSettings";
import { api } from "./client";

export const missingFiles = (model) =>
  (model?.dependencies || []).filter((f) => !f.choices.includes(f.value));
function refreshModels() {
  window.dispatchEvent(new Event(environmentEvent));
  localStorage.setItem(environmentEvent, String(Date.now()));
}

export function ModelPicker({
  kind,
  models,
  model,
  engine,
  onChoose,
  notify,
  triggerRef,
}) {
  const [view, setView] = useState(""),
    [query, search] = useState("");
  const [setup, configure] = useState(null),
    [values, change] = useState({}),
    [error, report] = useState(""),
    [saving, save] = useState(false);
  const localAnchor = useRef(null);
  const anchor = triggerRef || localAnchor;
  const close = () => setView("");
  const unavailable = (engine?.unavailable || []).filter(
    (m) => m.kind === kind,
  );
  const filtered = (list) =>
    list.filter((m) =>
      [m.name, m.baseModel].some((s) =>
        s?.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    );
  const sections =
    kind === "video"
      ? [
          ["视频生成模型", models.filter((m) => m.baseModel || !m.workflow)],
          [
            "预设工作流",
            models.filter(
              (m) => m.workflow && !m.baseModel && m.hasPrompt !== false,
            ),
          ],
          [
            "视频工具",
            models.filter(
              (m) => m.workflow && !m.baseModel && m.hasPrompt === false,
            ),
          ],
        ]
      : [
          ["预设工作流", models.filter((m) => m.workflow)],
          ["基础模型", models.filter((m) => !m.workflow)],
        ];
  function openSetup(m) {
    configure(m);
    change({});
    report("");
    setView("files");
  }
  async function saveFiles() {
    save(true);
    report("");
    try {
      await api(
        "/workflows/" + encodeURIComponent(setup.id) + "/files",
        "PUT",
        { environment: engine.environment, values },
      );
      onChoose(setup);
      refreshModels();
      notify("已保存当前环境的模型配置");
      close();
    } catch (e) {
      report(e.message);
    } finally {
      save(false);
    }
  }
  return (
    <>
      <button
        type="button"
        ref={anchor}
        className="model-picker-trigger"
        aria-label={
          "选择" +
          { image: "图片", video: "视频", audio: "音频" }[kind] +
          "模型或工作流"
        }
        aria-haspopup="dialog"
        aria-expanded={!!view}
        onClick={() => {
          search("");
          setView("list");
        }}
      >
        <Boxes size={15} />
        <span>{model?.name || "选择模型或工作流"}</span>
        <ChevronDown size={13} />
      </button>
      {view === "list" && (
        <Panel title="模型与工作流" icon={Boxes} anchor={anchor} close={close}>
          <div className="model-picker-content">
            <label className="model-search">
              <Search size={15} />
              <input
                autoFocus
                aria-label="搜索模型或工作流"
                placeholder="搜索名称"
                value={query}
                onChange={(e) => search(e.target.value)}
              />
            </label>
            {sections.map(
              ([title, list]) =>
                filtered(list).length > 0 && (
                  <section key={title}>
                    <h3>{title}</h3>
                    {filtered(list).map((m) => {
                      const missing = missingFiles(m);
                      return (
                        <div className="model-row" key={m.id}>
                          <button
                            type="button"
                            aria-pressed={model?.id === m.id}
                            onClick={() => {
                              if (missing.length) openSetup(m);
                              else {
                                onChoose(m);
                                close();
                              }
                            }}
                          >
                            {m.workflow && !m.baseModel ? (
                              <Workflow size={16} />
                            ) : (
                              <Boxes size={16} />
                            )}
                            <span>
                              <b>{m.name}</b>
                              {m.workflow && (
                                <small>
                                  {m.baseModel || workflowNeeds(m)}
                                  {m.id === h3VideoModelId && " · 原生分辨率"}
                                  {missing.length
                                    ? " · 待匹配 " + missing.length + " 个文件"
                                    : ""}
                                </small>
                              )}
                            </span>
                            {model?.id === m.id && <Check size={15} />}
                          </button>
                          {!!m.dependencies?.length && !m.baseModel && (
                            <button
                              type="button"
                              title={"配置 " + m.name}
                              aria-label={"配置 " + m.name}
                              onClick={() => openSetup(m)}
                            >
                              <FolderCog size={16} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </section>
                ),
            )}
            {filtered(unavailable).length > 0 && (
              <section>
                <h3>当前环境缺少依赖</h3>
                {filtered(unavailable).map((m) => (
                  <div key={m.id} className="model-unavailable">
                    <b>{m.name}</b>
                    <small>{m.reason}</small>
                  </div>
                ))}
              </section>
            )}
            {!filtered([...models, ...unavailable]).length && (
              <p className="panel-note">
                {engine?.online
                  ? "没有匹配的模型或预设"
                  : engine?.message || "正在读取当前环境…"}
              </p>
            )}
          </div>
          <div className="model-import">
            <button
              type="button"
              disabled={!engine?.online}
              onClick={() => setView("import")}
            >
              <FileUp size={15} />
              导入工作流 JSON
            </button>
          </div>
        </Panel>
      )}
      {view === "files" && (
        <Panel
          title="配置工作流模型"
          icon={FolderCog}
          subtitle={setup.name}
          anchor={anchor}
          close={close}
          actions={
            <>
              <span>保存在当前 ComfyUI 环境</span>
              <button
                className="solid panel-primary"
                disabled={
                  saving ||
                  setup.dependencies.some(
                    (f) => !f.choices.includes(values[f.key] ?? f.value),
                  )
                }
                onClick={saveFiles}
              >
                保存并使用
              </button>
            </>
          }
        >
          <div className="settings-body workflow-mappings">
            {setup.dependencies.map((f) => (
              <label key={f.key}>
                {f.title}
                <small>预设文件 · {String(f.original)}</small>
                <Select
                  value={JSON.stringify(values[f.key] ?? f.value)}
                  onValueChange={(next) =>
                    change({ ...values, [f.key]: JSON.parse(next) })
                  }
                >
                  {!f.choices.includes(values[f.key] ?? f.value) && (
                    <option value={JSON.stringify(f.value)}>
                      请选择对应文件
                    </option>
                  )}
                  {f.choices.map((v) => (
                    <option key={v} value={JSON.stringify(v)}>
                      {String(v)}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
            {error && <p role="alert">{error}</p>}
          </div>
        </Panel>
      )}
      {view === "import" && (
        <WorkflowImport
          close={close}
          notify={notify}
          onSaved={(id, type, refs) => {
            if (type === kind) onChoose({ id, workflow: true, maxRefs: refs });
            refreshModels();
          }}
        />
      )}
    </>
  );
}
