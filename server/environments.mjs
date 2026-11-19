import { defaultMaxSide } from "../shared/generation-size.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { settings, changeSettings } from "./files.mjs";
import { fail } from "./storage.mjs";

export async function maxSideFor(url = currentUrl()) {
  return (
    (await settings()).profiles.find((p) => p.url === url)?.maxSide ??
    defaultMaxSide
  );
}
const scope = new AsyncLocalStorage();
export function normalizeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("请输入完整的 ComfyUI 服务地址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw fail("地址需要使用 HTTP 或 HTTPS，可包含反向代理路径");
  return url.href.replace(/\/+$/, "");
}
export function defaultUrl() {
  return normalizeUrl(process.env.COMFYUI_URL || "http://127.0.0.1:8188");
}
export async function environments() {
  const { profiles, active } = await settings();
  const fallback = defaultUrl();
  if (!profiles.some((p) => p.url === fallback))
    profiles.push({ url: fallback, name: "默认环境" });
  return {
    active: active || fallback,
    profiles: profiles.map(({ url, name, maxSide }) => ({
      url,
      name,
      maxSide: maxSide ?? defaultMaxSide,
    })),
  };
}
export async function withEnvironment(url, fn, token) {
  if (token === undefined)
    token =
      (await settings()).profiles.find((p) => p.url === url)?.token ??
      (url === defaultUrl() ? process.env.COMFYUI_TOKEN : "");
  return scope.run({ url, token }, fn);
}
export const currentUrl = () => scope.getStore()?.url || defaultUrl();
export const currentToken = () =>
  scope.getStore()?.token ?? process.env.COMFYUI_TOKEN;
export async function saveEnvironment(url, name, token, maxSide) {
  if (
    maxSide !== undefined &&
    (!Number.isSafeInteger(maxSide) || maxSide < 16 || maxSide > 131072)
  )
    throw fail("最长边须为 16 到 131072 之间的整数");
  await changeSettings((state) => {
    let profile = state.profiles.find((p) => p.url === url);
    if (!profile) {
      profile = { url };
      state.profiles.push(profile);
    }
    profile.name = name;
    if (token !== undefined) profile.token = token;
    if (maxSide !== undefined) profile.maxSide = maxSide;
    state.active = url;
  });
}
