import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { activeRelease, checkoutVersion, refreshSourceBuild } from "./studio-update.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
let active = await activeRelease(root);
const head = await checkoutVersion(root).catch(() => null);
if (head && active.id && head !== active.id) active = { id: "", directory: root };
if (!active.id) await refreshSourceBuild(root, head);
const supervisor = pathToFileURL(path.join(active.directory, "server/studio-supervisor.mjs"));
const { runStudio } = await import(supervisor.href);
await runStudio(root, active, head);
