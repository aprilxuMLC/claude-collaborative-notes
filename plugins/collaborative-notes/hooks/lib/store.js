// Host-facing storage: project bindings in the plugin store, lane files under
// the bound notes root, versioned writes. Every function takes `io`, the host
// operations register.tsx builds from `$` (the engine object never crosses an
// import): exists, stat, list, read, write, makeDirs, moveFile, storeGet, storeSet.
import { isLaneKey } from "./lanes.js";
import { appendPlainNote, appendSourcedNote, deleteItem, editBody, versionOf } from "./notes.js";
import { isAbsolutePath, normalizePath } from "./platform.js";

const BINDINGS = "bindings";
const HINTED = "hinted";

const join = (...parts) => normalizePath(parts.join("/")).replace(/\/+/g, "/");
const dirOf = (path) => path.slice(0, path.lastIndexOf("/"));
const baseOf = (path) => path.slice(path.lastIndexOf("/") + 1);

export const rootExists = (io, root) => io.exists(root);

// ---- bindings -------------------------------------------------------------

export async function getBinding(io, project) {
  const all = (await io.storeGet(BINDINGS)) ?? {};
  return all[project] ?? null;
}

export async function setBinding(io, project, root) {
  const all = (await io.storeGet(BINDINGS)) ?? {};
  all[project] = { root, boundAt: new Date().toISOString() };
  await io.storeSet(BINDINGS, all);
  return all[project];
}

// True once per project: whether to show the "type /notes" hint now.
export async function takeHint(io, project) {
  const seen = (await io.storeGet(HINTED)) ?? [];
  if (seen.includes(project)) return false;
  await io.storeSet(HINTED, [...seen, project]);
  return true;
}

export function proposedRoot(project) {
  return join(project, "notes");
}

// Resolve a typed location: absolute, or relative to the project.
export function resolveLocation(project, typed) {
  const windows = /^[A-Za-z]:[\\/]/.test(String(project));
  const value = normalizePath(String(typed ?? "").trim(), windows);
  if (!value) return null;
  if (value.includes("\0")) return null;
  const base = normalizePath(project, windows);
  const path = isAbsolutePath(value) ? value : join(base, value);
  const drive = /^([A-Za-z]:)\//.exec(path);
  const prefix = drive ? `${drive[1]}/` : path.startsWith("/") ? "/" : "";
  const parts = [];
  for (const part of path.slice(prefix.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (parts.length === 0) return null; parts.pop(); continue; }
    parts.push(part);
  }
  return `${prefix}${parts.join("/")}` || "/";
}

// Inspect a candidate root for the setup gate.
export async function inspectRoot(io, root) {
  if (!(await io.exists(root))) return { exists: false, lanes: [] };
  const stat = await io.stat(root).catch(() => null);
  if (!stat || stat.kind !== "dir") return { exists: true, notDir: true, lanes: [] };
  const entries = await io.list(root).catch(() => []);
  const lanes = entries.filter((e) => e.kind === "dir" && isLaneKey(e.name)).map((e) => e.name);
  return { exists: true, lanes };
}

// Create the root at setup time (and only then).
export async function createRoot(io, root) {
  const run = await io.makeDirs(root);
  return run.exitCode === 0;
}

// ---- lanes ----------------------------------------------------------------

export function lanePath(root, lane, sessionId) {
  if (!isLaneKey(lane)) throw new Error(`unknown lane ${lane}`);
  return join(root, lane, `${sessionId}.md`);
}

export async function readLane(io, path) {
  const exists = await io.exists(path);
  const text = exists ? await io.read(path) : "";
  return { text, version: await versionOf(text), exists };
}

const queues = new Map();
function serialize(key, task) {
  const prior = queues.get(key) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(task);
  queues.set(key, next);
  return next;
}

// Replace a lane file if it is still at `expected`. Never recreates a missing root.
// `stillWanted` (optional, synchronous) is asked at the last moment before
// the file is replaced; false cancels the write (an editor discarded meanwhile).
export function writeLane(io, root, path, expected, text, stillWanted) {
  return serialize(path, async () => {
    if (!(await rootExists(io, root))) return { ok: false, code: "ROOT_MISSING" };
    const current = await readLane(io, path);
    if (current.version !== expected) return { ok: false, code: "STALE", current };
    const temporary = join(dirOf(path), `.${baseOf(path)}.${Math.random().toString(36).slice(2)}.tmp`);
    try {
      await io.write(temporary, text);
      if (stillWanted && !stillWanted()) {
        await io.removeFile?.(temporary);
        return { ok: false, code: "EDITOR_CANCELED" };
      }
      const moved = await io.moveFile(temporary, path);
      if (moved.exitCode !== 0) return { ok: false, code: "WRITE_FAILED", detail: moved.stderr.slice(0, 200) };
    } catch (error) {
      return { ok: false, code: "WRITE_FAILED", detail: String(error).slice(0, 200) };
    }
    return { ok: true, version: await versionOf(text) };
  });
}

// Append a note to this session's lane file: plain, or quoted when `quote`
// ({ snapshot, source }) is given.
export async function addPlainNote(io, { root, lane, sessionId, body, quote }) {
  const path = lanePath(root, lane, sessionId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readLane(io, path);
    const next = quote
      ? appendSourcedNote(current.text, { body, sessionId, snapshot: quote.snapshot, source: quote.source })
      : appendPlainNote(current.text, { body, sessionId });
    const written = await writeLane(io, root, path, current.version, next.text);
    if (written.ok) return { ok: true, key: next.key };
    if (written.code !== "STALE") return written;
  }
  return { ok: false, code: "STALE" };
}

// Change one note in this session's lane file, only if the lane is still at
// `expected`. With `overwrite`, the change is re-applied to the latest lane
// (never a stale body written back).
export async function mutateNote(io, { root, lane, sessionId, key, expected, change, overwrite = false, beforeWrite, stillWanted }) {
  const path = lanePath(root, lane, sessionId);
  for (let attempt = 0; attempt < (overwrite ? 3 : 1); attempt += 1) {
    const current = await readLane(io, path);
    if (!overwrite && current.version !== expected) return { ok: false, code: "STALE", current };
    const next = change(current.text, key);
    if (!next.ok) return next;
    if (beforeWrite && !(await beforeWrite())) return { ok: false, code: "EDITOR_CANCELED" };
    const written = await writeLane(io, root, path, current.version, next.text, stillWanted);
    if (written.ok || written.code !== "STALE" || !overwrite) return written;
  }
  return { ok: false, code: "STALE" };
}

export const editNote = (io, args) => mutateNote(io, { ...args, change: (text, key) => editBody(text, key, args.body) });
export const deleteNote = (io, args) => mutateNote(io, { ...args, change: deleteItem });
