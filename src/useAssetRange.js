import { useEffect, useRef, useState } from "react";

// The anchor and card bounds stay in grid content coordinates as the list scrolls.
function rangeAt(drag) {
  const { grid, startX, startY, cards } = drag;
  const bounds = grid.getBoundingClientRect();
  const x = Math.max(0, Math.min(grid.clientWidth, drag.x - bounds.left)) + grid.scrollLeft;
  const y = Math.max(0, Math.min(grid.clientHeight, drag.y - bounds.top)) + grid.scrollTop;
  const left = Math.min(startX, x), top = Math.min(startY, y);
  const right = Math.max(startX, x), bottom = Math.max(startY, y);
  const ids = cards.filter(c => c.right >= left && c.left <= right && c.bottom >= top && c.top <= bottom)
    .map(c => c.id);
  return { ids, style: { left, top, width: right - left, height: bottom - top } };
}

export function useAssetRange(onSelect) {
  const gesture = useRef(null), suppressClick = useRef(false);
  const [range, setRange] = useState(null);

  function clear() {
    cancelAnimationFrame(gesture.current?.frame);
    gesture.current = null;
    setRange(null);
  }
  useEffect(() => () => cancelAnimationFrame(gesture.current?.frame), []);

  function redraw() {
    const drag = gesture.current;
    if (!drag?.cards || drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = 0;
      const { grid, y } = drag;
      const rect = grid.getBoundingClientRect();
      const edge = Math.min(36, rect.height / 4);
      const delta = Math.max(0, y - rect.bottom + edge) - Math.max(0, rect.top + edge - y);
      const before = grid.scrollTop;
      grid.scrollTop += Math.sign(delta) * Math.min(18, Math.ceil(Math.abs(delta) / 2));
      setRange(rangeAt(drag));
      if (grid.scrollTop !== before) redraw();
    });
  }
  return { range, handlers: {
    onPointerDown(e) {
      if (!e.isPrimary || e.button !== 0 || gesture.current) return;
      suppressClick.current = false;
      if (e.target.closest(".asset-favorite, .asset-edit-tags")) return;
      const grid = e.currentTarget, rect = grid.getBoundingClientRect();
      if (e.clientX - rect.left >= grid.clientWidth || e.clientY - rect.top >= grid.clientHeight) return;
      gesture.current = { id: e.pointerId, grid, downX: e.clientX, downY: e.clientY,
        startX: e.clientX - rect.left + grid.scrollLeft, startY: e.clientY - rect.top + grid.scrollTop };
      e.target.setPointerCapture(e.pointerId);
    },
    onPointerMove(e) {
      const drag = gesture.current;
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.cards) {
        if (Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) < 6) return;
        drag.cards = Array.from(drag.grid.querySelectorAll("[data-asset-id]"), el => ({
          id: el.dataset.assetId, left: el.offsetLeft, top: el.offsetTop,
          right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight,
        }));
        suppressClick.current = true;
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      redraw();
    },
    onScroll: redraw,
    onPointerUp(e) {
      const drag = gesture.current;
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.cards) {
        drag.x = e.clientX;
        drag.y = e.clientY;
        onSelect(rangeAt(drag).ids);
      }
      clear();
    },
    onLostPointerCapture(e) { if (gesture.current?.id === e.pointerId) clear(); },
    onPointerCancel(e) { if (gesture.current?.id === e.pointerId) clear(); },
    onDragStart(e) { e.preventDefault(); },
    onClickCapture(e) {
      if (e.detail && suppressClick.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick.current = false;
      }
    },
  }};
}
