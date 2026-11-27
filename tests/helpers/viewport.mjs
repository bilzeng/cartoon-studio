import assert from "node:assert/strict";

// Playwright click() scrolls the target into view. Check before clicking.
export async function assertActionInView(button) {
  await button.waitFor();
  const failure = await button.evaluate(el => {
    const r = el.getBoundingClientRect();
    const center = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && el.contains(center)) return "";
    return JSON.stringify({ viewport: [innerWidth, innerHeight], rect: r.toJSON(), hit: center?.outerHTML.slice(0, 100) });
  });
  assert.equal(failure, "", (await button.textContent() || await button.getAttribute("aria-label")) + " should be visible and reachable: " + failure);
}
