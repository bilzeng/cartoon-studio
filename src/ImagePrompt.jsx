import React, { useLayoutEffect, useRef, useState } from "react";
import { refLabel, refToken } from "./canvasReferences";
import { Media, AssetPreview } from "./ui";
import { AtSign, X } from "lucide-react";
import {
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  placeholder,
  tooltips,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  autocompletion,
  completionKeymap,
  closeCompletion,
} from "@codemirror/autocomplete";

const replaceRefs = StateEffect.define();
const externalText = Transaction.remote;
const maxLength = 40000;

function thumbnail(kind, url) {
  if (kind === "audio") {
    const icon = document.createElement("span");
    icon.className = "voice-thumb";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "♬";
    return icon;
  }
  const media = document.createElement(kind === "video" ? "video" : "img");
  media.src = url;
  if (kind === "video") {
    media.muted = true;
    media.playsInline = true;
    media.preload = "metadata";
  } else media.alt = "";
  return media;
}
class PictureToken extends WidgetType {
  constructor(token, ref) {
    super();
    this.token = token;
    const [, prefix, number] = token.match(/^@(图|视频|语音)(\d+)$/u);
    this.kind = { 图: "image", 视频: "video", 语音: "audio" }[prefix];
    this.label = refLabel(this.kind, Number(number));
    this.url = ref?.asset.url;
  }
  eq(other) {
    return this.token === other.token && this.url === other.url;
  }
  toDOM() {
    const chip = document.createElement(this.url ? "button" : "span");
    if (this.url) chip.type = "button";
    chip.className = "picture-token";
    chip.dataset.token = this.token;
    chip.title = this.label + (this.url ? "" : " · 参考已断开");
    chip.setAttribute("aria-label", this.url ? "预览 " + this.label : chip.title);
    if (this.url) chip.append(thumbnail(this.kind, this.url));
    else chip.classList.add("missing");
    chip.append(document.createTextNode(chip.title));
    return chip;
  }
}
function decorations(doc, refs) {
  const byToken = new Map(refs.map((r) => [refToken(r), r]));
  return Decoration.set(
    Array.from(doc.toString().matchAll(/@(图|视频|语音)(\d+)/gu), (match) =>
      Decoration.replace({
        widget: new PictureToken(match[0], byToken.get(match[0])),
      }).range(match.index, match.index + match[0].length),
    ),
  );
}
const pictures = StateField.define({
  create: () => ({ refs: [], marks: Decoration.none }),
  update(value, tr) {
    const next = tr.effects.find((e) => e.is(replaceRefs));
    if (!next && !tr.docChanged) return value;
    const refs = next?.value || value.refs;
    return { refs, marks: decorations(tr.newDoc, refs) };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (s) => s.marks),
    EditorView.atomicRanges.of((view) => view.state.field(field).marks),
  ],
});
function insertPicture(view, ref, from, to) {
  const insert = refToken(ref) + " ";
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.reference",
  });
  closeCompletion(view);
  view.focus();
}
function suggest(ctx) {
  const match = ctx.matchBefore(/@[^@\s，。！？、]*$/u);
  if (!match || /^@(图|视频|语音)\d+$/.test(match.text)) return null;
  const query = match.text.slice(1).toLowerCase();
  const options = ctx.state
    .field(pictures)
    .refs.filter((r) =>
      (
        r.title +
        " " +
        r.asset.name +
        " " +
        refLabel(r.asset.kind, r.number) +
        refToken(r)
      )
        .toLowerCase()
        .includes(query),
    )
    .map((ref) => ({
      label: refLabel(ref.asset.kind, ref.number),
      ref,
      apply(view, _, from, to) {
        insertPicture(view, ref, from, to);
      },
    }));
  return { from: match.from, options, filter: false };
}

export function ImagePrompt({
  promptLabel,
  projectId,
  assets,
  data,
  set,
  resolved,
  unlink,
  incoming,
  groupSources,
}) {
  const host = useRef(null),
    editor = useRef(null),
    props = useRef(null);
  props.current = { data, set, resolved };
  const [preview, setPreview] = useState(null);
  function insertRef(ref) {
    const view = editor.current;
    const { from, to } = view.state.selection.main;
    const typed = from === to && view.state.sliceDoc(0, from).match(/@[^@\s，。！？、]*$/u);
    const start = typed && !/^@(图|视频|语音)\d+$/u.test(typed[0]) ? from - typed[0].length : from;
    insertPicture(view, ref, start, to);
  }
  useLayoutEffect(() => {
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.current.data.text,
        extensions: [
          pictures,
          history(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label":
              props.current.data.kind === "video"
                ? "视频节点提示词"
                : props.current.data.kind === "audio"
                  ? "音频节点提示词"
                  : "图片节点提示词",
            role: "textbox",
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          placeholder(
            promptLabel && promptLabel !== "提示词"
              ? "填写" + promptLabel + "…"
              : props.current.data.kind === "audio"
                ? "描述声音，输入 @ 引用素材…"
                : "描述画面，输入 @ 引用素材…",
          ),
          tooltips({ parent: document.body }),
          autocompletion({
            override: [suggest],
            activateOnTypingDelay: 0,
            interactionDelay: 0,
            icons: false,
            tooltipClass: () => "picture-suggestions",
            addToOptions: [
              {
                position: 10,
                render(option) {
                  return thumbnail(option.ref.asset.kind, option.ref.asset.url);
                },
              },
            ],
          }),
          keymap.of([...completionKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorState.changeFilter.of(
            (tr) => !tr.docChanged || tr.newDoc.length <= maxLength,
          ),
          EditorView.updateListener.of((u) => {
            if (
              !u.docChanged ||
              u.transactions.every((tr) => tr.annotation(externalText))
            )
              return;
            const { set, resolved } = props.current;
            const input = u.transactions.some((tr) =>
              tr.isUserEvent("input.reference"),
            );
            set({
              text: u.state.doc.toString(),
              imageRefOrder: resolved.sourceIds,
              mediaRefOrder: resolved.orders,
              ...(input ? { canvasRef: "" } : {}),
            });
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const view = editor.current;
    const known = view.state.field(pictures).refs;
    const refs = resolved.refs;
    const same =
      refs.length === known.length &&
      refs.every(
        (r, i) =>
          r.id === known[i].id &&
          r.number === known[i].number &&
          r.title === known[i].title &&
          r.asset.url === known[i].asset.url &&
          r.asset.name === known[i].asset.name,
      );
    const changed = data.text !== view.state.doc.toString();
    if (!changed && same) return;
    view.dispatch({
      effects: same ? [] : [replaceRefs.of(refs)],
      changes: changed
        ? { from: 0, to: view.state.doc.length, insert: data.text }
        : undefined,
      annotations: [externalText.of(true), Transaction.addToHistory.of(false)],
    });
  }, [data.text, resolved.refs]);
  return (
    <>
      {!!resolved.refs.length && (
        <div className="ref-strip">
          {resolved.refs.map((r) => (
            <div key={r.id} className="ref-thumb">
              <button
                className="ref-preview"
                title={"查看 " + r.title}
                aria-label={"预览 " + refLabel(r.asset.kind, r.number) + " " + r.title}
                onClick={() => setPreview(r)}
              >
                <Media asset={r.asset} />
                <b>{refLabel(r.asset.kind, r.number)}</b>
              </button>
              <button className="ref-insert" aria-label={"插入引用 " + refLabel(r.asset.kind, r.number)}
                title="插入到提示词" onMouseDown={(e) => e.preventDefault()} onClick={() => insertRef(r)}>
                <AtSign size={14} />
              </button>
              {(r.id === "upload" ||
                (incoming.has(r.id) && !groupSources.has(r.id))) && (
                <button
                  className="ref-remove"
                  aria-label={"断开 " + refLabel(r.asset.kind, r.number)}
                  onClick={() => {
                    if (r.id === "upload")
                      set({ guideAssetId: "", canvasRef: "" });
                    else unlink(incoming.get(r.id).id);
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="picture-editor" ref={host} onClick={(e) => {
        const token = e.target.closest?.("button[data-token]")?.dataset.token;
        const ref = token && resolved.refs.find((r) => refToken(r) === token);
        if (ref) setPreview(ref);
      }} />
      {preview && <AssetPreview asset={preview.asset} assets={assets} projectId={projectId} label={refLabel(preview.asset.kind, preview.number)} caption={refLabel(preview.asset.kind, preview.number) + " · " + preview.title} close={() => setPreview(null)}
        insert={() => {
          setPreview(null);
          requestAnimationFrame(() => { if (editor.current) insertRef(preview); });
        }} />}
    </>
  );
}
