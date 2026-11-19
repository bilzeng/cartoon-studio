import React, {
  Children,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./select.css";

function optionsFrom(children, group) {
  return Children.toArray(children).flatMap((item) => {
    if (item.type === "optgroup")
      return optionsFrom(item.props.children, item.props.label);
    if (item.type !== "option") return [];
    const label = Children.toArray(item.props.children).join("");
    return [
      {
        label,
        value: String(item.props.value ?? label),
        disabled: item.props.disabled,
        group,
      },
    ];
  });
}
export function Select({
  value,
  onValueChange,
  children,
  multiple = false,
  disabled,
  menuAlign = "start",
  menuMinWidth = 160,
  menuClassName = "",
  renderOption,
  title,
  id,
  "aria-label": label,
}) {
  const trigger = useRef(null),
    popup = useRef(null),
    prefix = useRef({ text: "", at: 0 });
  const listId = useId();
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  const options = optionsFrom(children);
  const selected = new Set(multiple ? value.map(String) : [String(value)]);
  const current = options.filter((o) => selected.has(o.value));
  const enabled = options
    .map((o, i) => (o.disabled ? -1 : i))
    .filter((i) => i >= 0);
  function show() {
    const i = options.findIndex((o) => !o.disabled && selected.has(o.value));
    setActive(i >= 0 ? i : (enabled[0] ?? -1));
    setOpen(true);
  }
  function choose(i) {
    const o = options[i];
    if (!o || o.disabled) return;
    if (multiple)
      onValueChange(
        selected.has(o.value)
          ? value.filter((v) => v !== o.value)
          : [...value, o.value],
      );
    else {
      setOpen(false);
      onValueChange(o.value);
    }
    trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!open) return;
    const menu = popup.current,
      button = trigger.current;
    function place() {
      const r = button.getBoundingClientRect(),
        gap = 4,
        pad = 8;
      const below = innerHeight - r.bottom - gap - pad,
        above = r.top - gap - pad;
      const width = Math.min(innerWidth - 2 * pad, Math.max(r.width, menuMinWidth));
      menu.style.width = width + "px";
      const required = Math.min(320, menu.scrollHeight + 2);
      const flip = below < required && above > below;
      menu.style.maxHeight =
        Math.max(1, Math.min(320, flip ? above : below)) + "px";
      const left = menuAlign === "end" ? r.right - width : r.left;
      menu.style.left = Math.max(pad, Math.min(left, innerWidth - width - pad)) + "px";
      menu.style.top =
        Math.max(pad, flip ? r.top - gap - menu.offsetHeight : r.bottom + gap) +
        "px";
    }
    menu.showPopover?.();
    place();
    function outside(e) {
      if (!button.contains(e.target) && !menu.contains(e.target))
        setOpen(false);
    }
    function scrolling(e) {
      if (!menu.contains(e.target)) place();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scrolling, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scrolling, true);
      window.removeEventListener("resize", place);
    };
  }, [open, menuAlign, menuMinWidth]);
  useLayoutEffect(() => {
    if (open)
      popup.current
        ?.querySelector('[data-index="' + active + '"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function key(e) {
    const k = e.key;
    if (k === "Tab") {
      setOpen(false);
      return;
    }
    if (k === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (
      !["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(k) &&
      k.length !== 1
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    if (!open) show();
    if (k === "Enter" || k === " ") {
      if (open) choose(active);
      return;
    }
    if (k === "Home" || k === "End")
      setActive(k === "Home" ? enabled[0] : enabled.at(-1));
    else if (k === "ArrowDown" || k === "ArrowUp") {
      if (open && enabled.length)
        setActive(
          enabled[
            (enabled.indexOf(active) +
              (k === "ArrowUp" ? -1 : 1) +
              enabled.length) %
              enabled.length
          ],
        );
    } else {
      const now = Date.now();
      prefix.current = {
        text:
          (now - prefix.current.at < 650 ? prefix.current.text : "") +
          k.toLowerCase(),
        at: now,
      };
      const match = enabled.find((i) =>
        options[i].label.toLowerCase().startsWith(prefix.current.text),
      );
      if (match !== undefined) setActive(match);
    }
  }
  return (
    <>
      <button
        type="button"
        title={title}
        id={id}
        ref={trigger}
        className="studio-select"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && active >= 0 ? listId + "-" + active : undefined
        }
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={key}
        onBlur={() => setOpen(false)}
      >
        <span>{current.map((o) => o.label).join("、") || "请选择"}</span>
        <ChevronDown size={15} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            id={listId}
            ref={popup}
            popover="manual"
            className={`studio-options ${menuClassName}`.trimEnd()}
            role="listbox"
            aria-label={label || "可选项"}
            aria-multiselectable={multiple || undefined}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse") e.preventDefault();
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <React.Fragment key={i}>
                {o.group && o.group !== options[i - 1]?.group && (
                  <div role="presentation" className="studio-option-group">
                    {o.group}
                  </div>
                )}
                <div
                  id={listId + "-" + i}
                  data-index={i}
                  role="option"
                  aria-label={renderOption ? o.label : undefined}
                  title={renderOption ? o.label : undefined}
                  aria-selected={selected.has(o.value)}
                  aria-disabled={o.disabled || undefined}
                  data-active={active === i}
                  onPointerMove={() => !o.disabled && setActive(i)}
                  onClick={(e) => {
                    e.stopPropagation();
                    choose(i);
                  }}
                >
                  {renderOption ? renderOption(o) : <span>{o.label}</span>}
                  {selected.has(o.value) && <Check size={15} aria-hidden />}
                </div>
              </React.Fragment>
            ))}
          </div>,
          trigger.current.closest("dialog") || document.body,
        )}
    </>
  );
}
