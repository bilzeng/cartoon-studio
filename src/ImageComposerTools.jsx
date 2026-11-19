import { api, uploadAsset } from "./client";
import { availableStyles } from "../shared/canvas";
import React, { useState, useRef, useEffect } from "react";
import {
  Check,
  Heart,
  Layers,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Modal } from "./ui";
const shortName = (name) =>
  name
    .split(/[/\\]/)
    .at(-1)
    .replace(/\.safetensors$/i, "");
function readNames(key) {
  try {
    const names = JSON.parse(localStorage.getItem(key));
    return Array.isArray(names) ? names : [];
  } catch {
    return [];
  }
}
export function StyleGallery({
  model,
  data,
  set,
  engine,
  close,
  chooseVideoModel,
  projectId,
}) {
  const [query, search] = useState(""),
    [tab, selectTab] = useState("风格广场");
  const namespace = "studio-styles:" + engine?.environment + ":";
  const [preferences, setPreferences] = useState(null),
    [savingPreferences, setSavingPreferences] = useState(false);
  const { favorites = [], recent = [] } = preferences || {};
  const upload = useRef(null),
    [coverName, pickCover] = useState(""),
    [localCovers, setCovers] = useState({}),
    [failed, setFailed] = useState({}),
    [error, report] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const environment = engine?.environment;
  useEffect(() => {
    if (!environment) return;
    let live = true;
    setPreferences(null);
    const favorites = readNames(namespace + "favorites"),
      recent = readNames(namespace + "recent");
    const load =
      favorites.length || recent.length
        ? api("/lora-preferences", "PUT", {
            environment,
            action: "import",
            favorites,
            recent,
          })
        : api("/lora-preferences?" + new URLSearchParams({ environment }));
    load
      .then((prefs) => {
        if (!live) return;
        setPreferences(prefs);
        localStorage.removeItem(namespace + "favorites");
        localStorage.removeItem(namespace + "recent");
      })
      .catch((e) => live && report(e.message));
    return () => {
      live = false;
    };
  }, [namespace, environment]);
  async function remember(action, name) {
    setSavingPreferences(true);
    try {
      setPreferences(
        await api("/lora-preferences", "PUT", { environment, action, name }),
      );
    } catch (e) {
      report(e.message);
    } finally {
      setSavingPreferences(false);
    }
  }
  async function setCover(file) {
    if (!file) return;
    setCoverNote("");
    const name = coverName;
    try {
      if (!["image/webp", "image/jpeg", "image/png"].includes(file.type))
        throw Error("请选择 PNG、JPEG 或 WebP 封面");
      const asset = await uploadAsset(file, projectId);
      const { url } = await api("/lora-cover", "PUT", {
        environment: engine.environment,
        name,
        assetId: asset.id,
      });
      setCovers((old) => ({ ...old, [name]: url }));
      if (asset.duplicate) setCoverNote("素材已存在，已用作封面");
      report("");
      window.dispatchEvent(
        new CustomEvent("studio-lora-cover", {
          detail: { environment: engine.environment, name, url },
        }),
      );
    } catch (e) {
      report(e.message);
    } finally {
      if (upload.current) upload.current.value = "";
    }
  }
  const choices = data.imageLoras || [];
  const available = availableStyles(model, data.workflowValues);
  const filtered = (tab === "最近使用" ? recent : available).filter(
    (n) =>
      available.includes(n) &&
      n.toLowerCase().includes(query.trim().toLowerCase()) &&
      (tab !== "我的收藏" || favorites.includes(n)),
  );
  function toggle(name) {
    if (choices.some((l) => l.name === name)) {
      set({ imageLoras: choices.filter((l) => l.name !== name) });
      return;
    }
    set({ imageLoras: [...choices, { name, strength: 1 }] });
    if (preferences) remember("use", name);
  }
  function star(name) {
    remember(favorites.includes(name) ? "unstar" : "star", name);
  }
  return (
    <Modal title="风格广场" close={close} wide>
      <div className="style-gallery">
        <div className="gallery-tools">
          <div className="gallery-tabs">
            {["风格广场", "我的收藏", "最近使用"].map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => selectTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <label>
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="搜索 LoRA 名称"
              aria-label="搜索 LoRA"
            />
          </label>
        </div>
        <p className="gallery-model">
          {model?.name || "请先选择模型"} · {available.length} 个匹配风格
        </p>
        {filtered.length ? (
          <div className="style-grid">
            {filtered.map((name) => {
              const active = choices.some((l) => l.name === name);
              const preview = localCovers[name] || engine?.loraCovers?.[name];
              return (
                <article key={name} data-selected={active}>
                  <button
                    className="choose-style"
                    aria-pressed={active}
                    disabled={
                      savingPreferences ||
                      (!active &&
                        ((!preferences && environment && !error) ||
                          choices.length >= 8))
                    }
                    title={name}
                    onClick={() => toggle(name)}
                  >
                    <span className="style-cover">
                      {preview && failed[name] !== preview ? (
                        <img
                          src={preview}
                          loading="lazy"
                          onError={() =>
                            setFailed((prev) => ({ ...prev, [name]: preview }))
                          }
                          alt={shortName(name) + " 的 LoRA 封面"}
                        />
                      ) : (
                        <span className="no-cover">
                          <Layers size={23} />
                          暂无封面
                        </span>
                      )}
                    </span>
                    <strong>{shortName(name)}</strong>
                    {active && <Check size={15} />}
                  </button>
                  <button
                    className="cover-action"
                    type="button"
                    aria-label={"设置封面 " + shortName(name)}
                    onClick={() => {
                      pickCover(name);
                      upload.current.click();
                    }}
                  >
                    设置封面
                  </button>
                  <button
                    className="style-star"
                    aria-label={"收藏 " + shortName(name)}
                    aria-pressed={favorites.includes(name)}
                    disabled={!preferences || savingPreferences}
                    onClick={() => star(name)}
                  >
                    <Heart size={14} />
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="style-empty">
            {!available.length
              ? chooseVideoModel
                ? model?.hasPrompt === false
                  ? "这个视频工具沿用原画面。选择视频生成模型后可添加 LoRA。"
                  : "当前视频模型没有匹配的本地 LoRA。"
                : "当前模型没有匹配的本地 LoRA。可以直接生成，或切换图片模型。"
              : "没有符合条件的风格"}
            {!available.length && chooseVideoModel && (
              <button className="choose-video-model" onClick={chooseVideoModel}>
                选择视频生成模型
              </button>
            )}
          </p>
        )}
        {choices.length > 0 && (
          <div className="style-strengths">
            {choices.map((l) => (
              <label key={l.name}>
                <SlidersHorizontal size={14} />
                <span>{shortName(l.name)}</span>
                <input
                  aria-label={shortName(l.name) + " 强度"}
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={l.strength}
                  onChange={(e) =>
                    set({
                      imageLoras: choices.map((item) =>
                        item.name === l.name
                          ? { ...item, strength: Number(e.target.value) }
                          : item,
                      ),
                    })
                  }
                />
                <output>{l.strength.toFixed(2)}</output>
                <button
                  type="button"
                  aria-label={"移除 " + l.name}
                  onClick={() => toggle(l.name)}
                >
                  <X size={14} />
                </button>
              </label>
            ))}
          </div>
        )}
        <input
          hidden
          type="file"
          ref={upload}
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setCover(e.target.files[0])}
        />
        {coverNote && <p role="status">{coverNote}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="gallery-foot">
          {model?.hasPrompt !== false && (
            <label>
              补充画风
              <input
                value={data.styleHint || ""}
                maxLength={1500}
                placeholder="可选，随提示词提交"
                onChange={(e) => set({ styleHint: e.target.value })}
              />
            </label>
          )}
          <button className="solid" onClick={close}>
            完成
          </button>
        </div>
      </div>
    </Modal>
  );
}
