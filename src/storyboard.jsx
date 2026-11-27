import { Select } from "./Select";
import React, { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Film,
  ImagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import {
  referenceTypes,
  referencesForShot,
  shotFields,
  shotPrompt,
} from "../shared/storyboard";
import { frameAsset, makeId } from "../shared/studio";
import { api, uploadAsset } from "./client";
import { Media, Modal } from "./ui";

export function ShotTable({
  board,
  shots,
  assets,
  update,
  move,
  add,
  remove,
  generate,
  history,
  linkRefs,
  manage,
}) {
  function input(n, key, label) {
    const long = ["text", "dialogue", "sound"].includes(key);
    const Tag = long ? "textarea" : "input";
    return (
      <label className="sheet-field" key={key}>
        <span>{label}</span>
        <Tag
          value={n.data[key] || ""}
          maxLength={key === "text" ? 40000 : 1500}
          aria-label={n.data.title + " · " + label}
          onChange={(e) => update(n.id, { [key]: e.target.value })}
        />
      </label>
    );
  }
  return (
    <div className="shot-sheet">
      <header className="sheet-heading">
        <div>
          <h2>分镜表</h2>
          <small>
            {shots.length} 镜 ·{" "}
            {shots.reduce((sum, n) => sum + n.data.duration, 0)} 秒
          </small>
        </div>
        <button className="outline" onClick={manage}>
          <BookOpen size={15} />
          角色 / 场景 / 道具
        </button>
        <button className="solid" onClick={add}>
          <Plus size={15} />
          添加分镜
        </button>
      </header>
      {shots.length ? (
        <div className="sheet-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "镜号与时长",
                  "画面描述",
                  "摄影",
                  "声音",
                  "设定引用",
                  "生成与采用",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shots.map((n, i) => {
                const refs = referencesForShot(board, n.data);
                const current = frameAsset(n, board, assets);
                return (
                  <tr key={n.id}>
                    <td>
                      <strong className="shot-index">
                        {String(i + 1).padStart(2, "0")}
                      </strong>
                      <label className="sheet-field">
                        镜头名称
                        <input
                          maxLength={120}
                          value={n.data.title}
                          onChange={(e) =>
                            update(n.id, { title: e.target.value })
                          }
                        />
                      </label>
                      <label className="sheet-field">
                        时长（秒）
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={n.data.duration}
                          onChange={(e) =>
                            update(n.id, {
                              duration: Math.min(
                                30,
                                Math.max(1, Number(e.target.value) || 1),
                              ),
                            })
                          }
                        />
                      </label>
                      <div className="sheet-order">
                        <button
                          aria-label={"上移 " + n.data.title}
                          disabled={!i}
                          onClick={() => move(n.id, -1)}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          aria-label={"下移 " + n.data.title}
                          disabled={i === shots.length - 1}
                          onClick={() => move(n.id, 1)}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          aria-label={"删除 " + n.data.title}
                          onClick={() => remove(n)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                    <td>
                      {input(n, "text", "画面描述")}
                      {["imagePrompt", "videoPrompt"].filter(key => n.data[key] !== undefined).map(key =>
                        <details key={key}><summary>{key === "imagePrompt" ? "编辑绘图提示词" : "编辑视频提示词"}</summary>
                          <textarea aria-label={key === "imagePrompt" ? "绘图提示词" : "视频提示词"} maxLength={4000} value={n.data[key]} onChange={e => update(n.id, { [key]: e.target.value })} />
                        </details>
                      )}
                      <details>
                        <summary>图片提示词</summary>
                        <pre>{shotPrompt(board, n.data)}</pre>
                      </details>
                    </td>
                    <td>
                      {["framing", "lighting", "camera"].map((k) =>
                        input(n, k, shotFields[k]),
                      )}
                    </td>
                    <td>
                      {["dialogue", "sound"].map((k) =>
                        input(n, k, shotFields[k]),
                      )}
                    </td>
                    <td>
                      <div className="ref-chips">
                        {refs.map((c) => (
                          <span key={c.id}>
                            {referenceTypes[c.type]} · {c.name}
                          </span>
                        ))}
                      </div>
                      <button
                        className="outline"
                        aria-label={n.data.title + " · 选择引用"}
                        onClick={() => linkRefs(n)}
                      >
                        选择引用
                      </button>
                    </td>
                    <td>
                      <div className="take-thumb">
                        {current ? (
                          <Media asset={current} controls />
                        ) : (
                          <small>尚无画面</small>
                        )}
                      </div>
                      <div className="sheet-actions">
                        <button className="outline" onClick={() => generate(n, "image")}>
                          <ImagePlus size={14} />
                          生图
                        </button>
                        <button className="outline" onClick={() => generate(n, "video")}>
                          <Film size={14} />
                          生视频
                        </button>
                      </div>
                      <button className="take-link" onClick={() => history(n)}>
                        本镜候选
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">添加第一镜，或从画布上的剧本拆镜。</p>
      )}
    </div>
  );
}

export function ReferenceManager({ board, assets, edit, close, refresh }) {
  const [type, setType] = useState("character"),
    [draft, setDraft] = useState(null);
  const [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const cards = board.referenceCards || [];
  const used = (id) =>
    board.nodes.filter((n) => n.data.referenceIds?.includes(id)).length;
  const change = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  function save(e) {
    e.preventDefault();
    const card = { ...draft, name: draft.name.trim() };
    if (!card.name) return;
    edit((b) => ({
      ...b,
      referenceCards: (b.referenceCards || []).some((c) => c.id === card.id)
        ? b.referenceCards.map((c) => (c.id === card.id ? card : c))
        : [...(b.referenceCards || []), card],
    }));
    setDraft(null);
  }
  async function upload(file) {
    if (!file) return;
    setUploading(true);
    setError("");
    setUploadNote("");
    try {
      if (file.size > 64 * 1024 * 1024) throw Error("单张参考图最多 64 MB");
      const a = await uploadAsset(file, board.id);
      if (a.kind !== "image") throw Error("请选择图片");
      await refresh();
      change("imageId", a.id);
      if (a.duplicate) setUploadNote("素材已存在，已选为参考图");
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <Modal wide title="角色、场景与道具" close={close}>
      {draft ? (
        <form className="form" onSubmit={save}>
          <label>
            {referenceTypes[draft.type]}名称
            <input
              autoFocus
              maxLength={100}
              required
              value={draft.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </label>
          <label>
            设定描述
            <textarea
              rows={3}
              maxLength={1500}
              value={draft.description}
              onChange={(e) => change("description", e.target.value)}
            />
          </label>
          <label>
            参考图
            <Select
              value={draft.imageId}
              onValueChange={(next) => { setUploadNote(""); change("imageId", next); }}
            >
              <option value="">仅使用文字设定</option>
              {assets
                .filter((a) => a.kind === "image")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </label>
          <label>
            上传参考图
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={(e) => upload(e.target.files[0])}
            />
          </label>
          {uploadNote && <p role="status">{uploadNote}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="card-actions">
            <button
              className="outline"
              type="button"
              disabled={uploading}
              onClick={() => setDraft(null)}
            >
              取消
            </button>
            <button
              className="solid"
              disabled={uploading || !draft.name.trim()}
            >
              保存设定卡
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="card-toolbar">
            <div className="seg">
              {Object.entries(referenceTypes).map(([k, name]) => (
                <button
                  key={k}
                  className={type === k ? "on" : ""}
                  onClick={() => setType(k)}
                >
                  {name}
                </button>
              ))}
            </div>
            <button
              className="solid"
              onClick={() => {
                setError("");
                setUploadNote("");
                setDraft({
                  id: makeId(),
                  type,
                  name: "",
                  description: "",
                  imageId: "",
                });
              }}
            >
              新建{referenceTypes[type]}
            </button>
          </div>
          <div className="reference-list">
            {cards
              .filter((c) => c.type === type)
              .map((c) => (
                <article key={c.id}>
                  {c.imageId && (
                    <Media asset={assets.find((a) => a.id === c.imageId)} />
                  )}
                  <div>
                    <strong>{c.name}</strong>
                    <p>{c.description}</p>
                    <small>{used(c.id)} 镜引用</small>
                  </div>
                  <button
                    className="outline"
                    onClick={() => {
                      setError("");
                      setUploadNote("");
                      setDraft({ ...c });
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="quiet danger"
                    disabled={!!used(c.id)}
                    title={used(c.id) ? "先在分镜中取消引用" : "删除设定卡"}
                    onClick={() =>
                      edit((b) => ({
                        ...b,
                        referenceCards: b.referenceCards.filter(
                          (card) => card.id !== c.id,
                        ),
                      }))
                    }
                  >
                    删除
                  </button>
                </article>
              ))}
          </div>
          {!cards.some((c) => c.type === type) && (
            <p className="empty">还没有{referenceTypes[type]}设定卡。</p>
          )}
        </>
      )}
    </Modal>
  );
}

export function ReferencePicker({ board, shot, update, close, manage }) {
  const cards = board.referenceCards || [],
    refs = shot.data.referenceIds || [];
  return (
    <Modal title={shot.data.title + " · 设定引用"} close={close}>
      <div className="form">
        {Object.entries(referenceTypes).map(([type, title]) => (
          <fieldset key={type} className="ref-group">
            <legend>{title}</legend>
            {type === "character" && (
              <label>
                <input
                  type="checkbox"
                  checked={!!shot.data.emptyCast}
                  onChange={(e) =>
                    update(shot.id, {
                      emptyCast: e.target.checked,
                      referenceIds: e.target.checked
                        ? refs.filter(
                            (id) =>
                              cards.find((c) => c.id === id)?.type !==
                              "character",
                          )
                        : refs,
                    })
                  }
                />
                <span>空镜，无人出场</span>
              </label>
            )}
            {cards
              .filter((c) => c.type === type)
              .map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    disabled={type === "character" && shot.data.emptyCast}
                    checked={refs.includes(c.id)}
                    onChange={(e) =>
                      update(shot.id, {
                        referenceIds: e.target.checked
                          ? [...refs, c.id]
                          : refs.filter((id) => id !== c.id),
                      })
                    }
                  />
                  <span>
                    {c.name}
                    <small>{c.description}</small>
                  </span>
                </label>
              ))}
            {!cards.some((c) => c.type === type) && (
              <small>暂无{title}设定卡</small>
            )}
          </fieldset>
        ))}
        <div className="card-actions">
          <button className="outline" onClick={manage}>
            管理设定卡
          </button>
          <button className="solid" onClick={close}>
            完成
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function TakeHistory({ board, shot, assets, refresh, close, adopt }) {
  const [rows, setRows] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      timer;
    async function pull() {
      try {
        const list = await api(
          "/projects/" + board.id + "/shots/" + shot.id + "/takes",
        );
        if (!live) return;
        setRows(list);
        setError("");
        await refresh();
        if (live && list.some((j) => j.status === "running"))
          timer = setTimeout(pull, 1800);
      } catch (e) {
        if (live) setError(e.message);
      }
    }
    pull();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [board.id, shot.id, refresh]);
  return (
    <Modal wide title={shot.data.title + " · 本镜候选"} close={close}>
      {error && <p role="alert">{error}</p>}
      {!rows && !error && <p>正在读取候选…</p>}
      {rows?.length === 0 && (
        <p>从本镜提交生图或生视频后，可在这里选择版本。</p>
      )}
      {rows?.map((j, i) => {
        const a = assets.find((x) => x.id === j.assetId),
          adopted = !!a && a.id === shot.data.assetId;
        return (
          <article className="take-row" key={j.id}>
            <div className="take-thumb">
              <Media asset={a} controls />
            </div>
            <div>
              <strong>
                版本 {rows.length - i} · {j.type === "video" ? "视频" : "图片"}
              </strong>
              <small>
                {j.snapshot.model} · Seed {j.snapshot.seed}
              </small>
              <details>
                <summary>提交时的设定与提示词</summary>
                <pre>{j.snapshot.prompt}</pre>
                <small>
                  {j.snapshot.ratio} · 时间线 {j.snapshot.duration} 秒
                </small>
                <small>
                  设定卡 ·{" "}
                  {j.snapshot.references
                    .map((c) => referenceTypes[c.type] + " " + c.name)
                    .join("、") || "无"}
                </small>
                <small>
                  输入参考图 ·{" "}
                  {assets.find((x) => x.id === j.snapshot.imageId)?.name ||
                    "无"}
                </small>
              </details>
              {j.status !== "done" && (
                <p role="status">
                  {j.status === "cancelled" ? "已取消" : j.status === "failed" ? "失败" : "处理中"} · {j.detail}
                </p>
              )}
            </div>
            <button
              className={adopted ? "outline" : "solid"}
              disabled={!a || adopted}
              onClick={() => adopt(j)}
            >
              {adopted ? "已采用" : "采用此版"}
            </button>
          </article>
        );
      })}
    </Modal>
  );
}
