import { fail } from "./storage.mjs";

const source = "https://raw.githubusercontent.com/JGRFW/comfyui-aicg3d-PoseSwap/44bb2f81489ebce1d11af5205698a4710dd27d7a/";
const libraries = new Map([
  ["person", {
    index: "portraits/data/portrait-zh.json", folder: "portraits/",
    fields: (row) => [row.title, row.section_zh, row.search, row.full, row.thumb],
  }],
  ["pose", {
    index: "library/data/pose-zh.json", folder: "library/",
    fields: (row) => [
      row["姿势名称"], row["分类"], [row["体系"], row["角度"], row["检索"]].join(" "),
      row["原图"], row["缩略图"],
    ],
  }],
  ["outfit", {
    index: "garments/data/garment.json", folder: "garments/",
    fields: (row) => [row.desc, row.cat_cn, row.cat, row.img, row.img],
  }],
]);
const safePath = /^(?:img\/(?:full\/|thumb\/)?|thumbs\/)[a-z0-9_-]+\.(?:jpe?g|webp|png)$/i;
const cache = new Map();

async function upstream(path) {
  const response = await fetch(source + path, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!response?.ok) throw fail("PoseSwap 图库暂时无法连接，请重试或上传图片", 502);
  return response;
}

function catalog(role) {
  const library = libraries.get(role);
  if (!library) throw fail("图库类别无效", 404);
  if (!cache.has(role)) {
    const pending = upstream(library.index).then((response) => response.json()).then((data) => {
      const rows = Array.isArray(data) ? data : data?.records;
      if (!Array.isArray(rows)) throw fail("PoseSwap 图库索引格式异常", 502);
      return rows.flatMap((row) => {
        if (!row || !/^[a-z0-9_-]{1,80}$/i.test(row.id || "")) return [];
        const [title, category, keywords, file, thumb] = library.fields(row);
        if (!safePath.test(file || "") || !safePath.test(thumb || "")) return [];
        return [{
          id: row.id, title: title || row.id, category: category || "", keywords: keywords || "",
          file: library.folder + file, thumbnail: source + library.folder + thumb,
        }];
      });
    }).catch((error) => {
      cache.delete(role);
      throw error.status ? error : fail("无法读取 PoseSwap 图库索引", 502);
    });
    cache.set(role, pending);
  }
  return cache.get(role);
}

export async function poseGallery(role) {
  return (await catalog(role)).map(({ file, ...item }) => item);
}

export async function downloadPoseReference(role, id) {
  const item = (await catalog(role)).find((row) => row.id === id);
  if (!item) throw fail("PoseSwap 素材不存在", 404);
  const response = await upstream(item.file);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 16 * 1024 * 1024)
    throw fail("PoseSwap 图片超过素材大小上限", 413);
  return { bytes, name: item.title.slice(0, 120) };
}
