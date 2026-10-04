// Lane-file operations on text, independent of the host: read cards out of a
// lane body, append a note. The host-facing reader/writer lives in store.js.
import {
  KIND_SOURCE_AWARE,
  KIND_SOURCE_INDEPENDENT,
  getItemKey,
  makeItem,
  newItemKey,
  parseLaneBody,
  serializeItem,
  serializeLaneBody,
  withItemKey,
} from "./structured-item.js";

export const HOST = "claude";

// Cards in file order. Legacy (non-block) text is kept as read-only cards.
export function readCards(text) {
  const parsed = parseLaneBody(text ?? "");
  const cards = [];
  parsed.nodes.forEach((node, index) => {
    if (node.type === "item") {
      const item = node.item;
      cards.push({
        index,
        key: getItemKey(item) ?? `pos-${index}`,
        kind: item.kind,
        body: item.comment ?? "",
        snapshot: item.kind === KIND_SOURCE_AWARE ? item.snapshot ?? "" : undefined,
        source: item.sourcePayload,
        origin: item.captureOrigin,
        host: item.host,
      });
    } else if (node.type === "legacy" && node.text.trim()) {
      cards.push({ index, key: `legacy-${index}`, kind: "legacy", body: node.text });
    }
  });
  return cards;
}

// The lane text with one new plain note appended. Never rewrites what was there.
export function appendPlainNote(text, { body, sessionId, key = newItemKey() }) {
  const item = withItemKey(
    makeItem({ kind: KIND_SOURCE_INDEPENDENT, captureOrigin: sessionId, comment: body, host: HOST }),
    key,
  );
  return { text: appendBlock(text, serializeItem(item)), key };
}

// The lane text with one quoted note appended: S (the snapshot), the source
// message identity, and an optional body.
export function appendSourcedNote(text, { body = "", sessionId, snapshot, source, key = newItemKey() }) {
  const item = withItemKey(
    makeItem({
      kind: KIND_SOURCE_AWARE, captureOrigin: sessionId, snapshot,
      ...(body ? { comment: body } : {}), sourcePayload: source, host: HOST,
    }),
    key,
  );
  return { text: appendBlock(text, serializeItem(item)), key };
}

function appendBlock(text, block) {
  const existing = text ?? "";
  if (existing.length === 0) return `${block}\n`;
  return `${existing}${existing.endsWith("\n") ? "" : "\n"}${block}\n`;
}

function findItem(parsed, key) {
  const matches = parsed.nodes.filter((node) => node.type === "item" && getItemKey(node.item) === key);
  if (matches.length === 0) return { ok: false, code: "ITEM_UNRESOLVED" };
  if (matches.length > 1) return { ok: false, code: "ITEM_AMBIGUOUS" };
  return { ok: true, node: matches[0] };
}

// The lane text with one note's authored body replaced. The quoted source,
// identity and key stay as they were.
export function editBody(text, key, body) {
  if (typeof body !== "string") return { ok: false, code: "INVALID_CONTENT" };
  const parsed = parseLaneBody(text ?? "");
  const found = findItem(parsed, key);
  if (!found.ok) return found;
  if (found.node.item.kind === KIND_SOURCE_INDEPENDENT && body.trim().length === 0) {
    return { ok: false, code: "EMPTY_CONTENT" };
  }
  found.node.item.comment = body;
  return { ok: true, text: serializeLaneBody(parsed) };
}

// The lane text without one note; neighbouring legacy text is kept.
export function deleteItem(text, key) {
  const parsed = parseLaneBody(text ?? "");
  const found = findItem(parsed, key);
  if (!found.ok) return found;
  const index = parsed.nodes.indexOf(found.node);
  const remaining = parsed.nodes.filter((_node, i) => i !== index);
  if (remaining.length === 0) return { ok: true, text: "" };
  const previous = remaining[index - 1];
  const next = remaining[index];
  if (previous?.type === "legacy") previous.text = previous.text.replace(/\n+$/g, "");
  if (next?.type === "legacy") next.text = next.text.replace(/^\n+/g, "");
  return { ok: true, text: serializeLaneBody({ nodes: remaining, trailingNewline: parsed.trailingNewline }) };
}

// The editor file: one header line, a rule, then the body. Reading back drops
// the header and rule when they are still there.
export const EDITOR_RULE = "────────────────────────────────────────";
export function editorFile(header, body) {
  return `${header}\n${EDITOR_RULE}\n${body}`;
}
export function editorBody(header, text) {
  let body = String(text ?? "");
  const lead = `${header}\n${EDITOR_RULE}\n`;
  if (body.startsWith(lead)) body = body.slice(lead.length);
  else if (body.startsWith(`${header}\n${EDITOR_RULE}`)) body = body.slice(`${header}\n${EDITOR_RULE}`.length);
  return body.replace(/\n$/, "");
}

export function editorBodyFromHeaders(headers, text) {
  for (const header of headers) {
    const value = String(text ?? "")
    const lead = `${header}\n${EDITOR_RULE}`
    if (value.startsWith(lead)) return editorBody(header, value)
  }
  return String(text ?? "").replace(/\n$/, "")
}

export const editorWriteArgs = (editing, body) => ({ key: editing.key, expected: editing.expected, body })
export const editorObservedState = (editing, body) => ({ ...editing, observed: body })
export const editorCommittedState = (editing, body, version) => ({ ...editing, observed: body, synced: body, expected: version })
export const editorCanFinish = (editing) => editing?.mode !== "new" && (editing?.observed ?? editing?.synced) === editing?.synced
export const editorMissingFinish = (editing) => editing?.observed === editing?.synced ? "close" : "keep"

export const editorSyncCanWrite = (startedGeneration, currentGeneration, started, current) =>
  startedGeneration === currentGeneration && Boolean(started?.path) && current?.path === started.path
  && current?.lane === started.lane && current?.key === started.key && current?.mode === started.mode
export const savedNewEditorCleanup = (editing) => ({ state: null, path: editing?.path ?? "" })

// Editor filenames never contain raw item keys. A short readable stem keeps
// files recognizable; the digest distinguishes keys with the same stem.
export async function editorPath(root, sessionPrefix, key, subtle = globalThis.crypto.subtle) {
  const value = String(key)
  const stem = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "item"
  const digest = await versionOf(value, subtle)
  const path = `${String(root).replace(/[\\/]+$/, "")}/.editing/${sessionPrefix}${stem}-${digest.slice(0, 12)}.txt`
  assertEditorPath(root, path)
  return path
}

export function assertEditorPath(root, path) {
  const cleanRoot = String(root).replace(/\\/g, "/").replace(/\/$/, "")
  const cleanPath = String(path).replace(/\\/g, "/")
  const prefix = `${cleanRoot}/.editing/`
  const name = cleanPath.startsWith(prefix) ? cleanPath.slice(prefix.length) : ""
  if (!name || name === "." || name === ".." || name.includes("/")) {
    throw new Error("editor path is outside the .editing directory")
  }
  return path
}

export async function versionOf(text, subtle = globalThis.crypto.subtle) {
  const bytes = new TextEncoder().encode(text ?? "");
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { KIND_SOURCE_AWARE, KIND_SOURCE_INDEPENDENT };
