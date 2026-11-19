export async function api(path, method = "GET", payload, signal) {
  const binary = payload instanceof Blob;
  const form = payload instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    signal,
    headers: payload && !form
      ? {
          "Content-Type": binary
            ? "application/octet-stream"
            : "application/json",
        }
      : {},
    body: payload ? (binary || form ? payload : JSON.stringify(payload)) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || "请求失败"), {
      status: response.status,
    });
  return data;
}
export function uploadAsset(file, projectId, tags = []) {
  const query = new URLSearchParams({ name: file.name });
  if (projectId) query.set("project", projectId);
  if (tags.length) {
    const form = new FormData();
    form.append("file", file);
    for (const tag of tags) form.append("tag", tag);
    return api("/assets?" + query, "POST", form);
  }
  return api("/assets?" + query, "POST", file);
}
export function downloadJson(board) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(board, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = board.name + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
