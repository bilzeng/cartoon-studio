const prefixes = { image: "图", video: "视频", audio: "语音" };
const numerals = new Intl.NumberFormat("zh-Hans-u-nu-hanidec", {
  useGrouping: false,
});
function chineseNumber(n) {
  if (n < 10) return numerals.format(n);
  if (n < 100)
    return (
      (n < 20 ? "" : numerals.format(Math.floor(n / 10))) +
      "十" +
      (n % 10 ? numerals.format(n % 10) : "")
    );
  return String(n);
}
export const refLabel = (kind, n) => prefixes[kind] + chineseNumber(n);
export const refToken = (ref) => "@" + prefixes[ref.asset.kind] + ref.number;
export { canvasMediaRefs } from "../shared/canvas.js";
