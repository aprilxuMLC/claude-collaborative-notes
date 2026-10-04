// Unit tests for the host-independent storage logic. Run: node --test test/
import assert from "node:assert/strict";
import { test } from "node:test";

import { appendPlainNote, assertEditorPath, deleteItem, editBody, editorBody, editorBodyFromHeaders, editorCanFinish, editorCommittedState, editorFile, editorMissingFinish, editorObservedState, editorPath, editorSyncCanWrite, editorWriteArgs, readCards, savedNewEditorCleanup, versionOf } from "../hooks/lib/notes.js";
import {
  addPlainNote, createRoot, deleteNote, editNote, getBinding, inspectRoot, lanePath, proposedRoot,
  readLane, resolveLocation, rootExists, setBinding, takeHint, writeLane,
} from "../hooks/lib/store.js";

const SESSION = "0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";

// An in-memory stand-in for the host operations register.tsx builds from `$`.
function fakeIo({ dirs = [], files = {} } = {}) {
  const d = new Set(dirs);
  const f = new Map(Object.entries(files));
  const store = new Map();
  const parentDirs = (path) => {
    const parts = path.split("/").slice(1, -1);
    for (let i = 1; i <= parts.length; i += 1) d.add(`/${parts.slice(0, i).join("/")}`);
  };
  for (const dir of dirs) parentDirs(`${dir}/x`);
  return {
    files: f,
    exists: async (p) => d.has(p) || f.has(p),
    stat: async (p) => (d.has(p) ? { kind: "dir" } : f.has(p) ? { kind: "file" } : Promise.reject(new Error("ENOENT"))),
    list: async (p) => [...d].filter((x) => x.startsWith(`${p}/`) && !x.slice(p.length + 1).includes("/"))
      .map((x) => ({ name: x.slice(p.length + 1), kind: "dir" })),
    read: async (p) => { if (!f.has(p)) throw new Error("ENOENT"); return f.get(p); },
    write: async (p, text) => { parentDirs(p); f.set(p, text); },
    makeDirs: async (path) => { d.add(path); parentDirs(`${path}/x`); return { exitCode: 0, stdout: "", stderr: "" }; },
    moveFile: async (from, to) => { f.set(to, f.get(from)); f.delete(from); return { exitCode: 0, stdout: "", stderr: "" }; },
    storeGet: async (k) => store.get(k),
    storeSet: async (k, v) => { store.set(k, structuredClone(v)); },
  };
}

test("a plain note round-trips as a dsh-note v1 block with host claude", () => {
  const { text, key } = appendPlainNote("", { body: "first line\nsecond line", sessionId: SESSION });
  assert.match(text, /^--- dsh-note v1 begin\n/);
  assert.match(text, /dsh-meta host: claude/);
  assert.match(text, new RegExp(`dsh-meta item-key: ${key}`));
  const cards = readCards(text);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].body, "first line\nsecond line");
  assert.equal(cards[0].kind, "source-independent");
  assert.equal(cards[0].key, key);
});

test("appending keeps existing text, including legacy lines, byte for byte", () => {
  const legacy = "old free text\n";
  const one = appendPlainNote(legacy, { body: "a", sessionId: SESSION }).text;
  assert.ok(one.startsWith(legacy));
  const two = appendPlainNote(one, { body: "b", sessionId: SESSION }).text;
  assert.ok(two.startsWith(one));
  const cards = readCards(two);
  assert.deepEqual(cards.map((c) => c.kind), ["legacy", "source-independent", "source-independent"]);
});

test("versions change with content", async () => {
  assert.notEqual(await versionOf("a"), await versionOf("b"));
  assert.equal(await versionOf(""), await versionOf(""));
});

test("addPlainNote writes this session's lane file under the bound root", async () => {
  const io = fakeIo({ dirs: ["/p/notes"] });
  const r = await addPlainNote(io, { root: "/p/notes", lane: "deferred_work", sessionId: SESSION, body: "x" });
  assert.equal(r.ok, true);
  const path = lanePath("/p/notes", "deferred_work", SESSION);
  assert.equal(path, `/p/notes/deferred_work/${SESSION}.md`);
  assert.equal(readCards(io.files.get(path))[0].body, "x");
  assert.equal([...io.files.keys()].some((k) => k.endsWith(".tmp")), false);
});

test("a missing root is reported and never recreated", async () => {
  const io = fakeIo();
  assert.equal(await rootExists(io, "/p/notes"), false);
  const r = await addPlainNote(io, { root: "/p/notes", lane: "conversation_todo", sessionId: SESSION, body: "x" });
  assert.deepEqual(r, { ok: false, code: "ROOT_MISSING" });
  assert.equal(io.files.size, 0);
});

test("a stale write is refused and leaves the newer content", async () => {
  const io = fakeIo({ dirs: ["/p/notes"] });
  const path = lanePath("/p/notes", "conversation_todo", SESSION);
  const before = await readLane(io, path);
  await io.write(path, "someone else's edit\n");
  const r = await writeLane(io, "/p/notes", path, before.version, "my stale text\n");
  assert.equal(r.ok, false);
  assert.equal(r.code, "STALE");
  assert.equal(io.files.get(path), "someone else's edit\n");
});

test("successful lane writes return the version of the committed text", async () => {
  const io = fakeIo({ dirs: ["/p/notes"] });
  const path = lanePath("/p/notes", "conversation_todo", SESSION);
  const current = await readLane(io, path);
  const written = await writeLane(io, "/p/notes", path, current.version, "committed\n");
  assert.equal(written.ok, true);
  assert.equal(written.version, await versionOf("committed\n"));
});

test("concurrent appends in one process both land", async () => {
  const io = fakeIo({ dirs: ["/p/notes"] });
  const args = { root: "/p/notes", lane: "conversation_todo", sessionId: SESSION };
  const [a, b] = await Promise.all([addPlainNote(io, { ...args, body: "one" }), addPlainNote(io, { ...args, body: "two" })]);
  assert.equal(a.ok && b.ok, true);
  const bodies = readCards(io.files.get(lanePath("/p/notes", "conversation_todo", SESSION))).map((c) => c.body);
  assert.deepEqual(bodies.sort(), ["one", "two"]);
});

test("bindings, the one-time hint and setup inspection", async () => {
  const io = fakeIo({ dirs: ["/p/notes/deferred_work"] });
  assert.equal(await getBinding(io, "/p"), null);
  await setBinding(io, "/p", "/p/notes");
  assert.equal((await getBinding(io, "/p")).root, "/p/notes");
  assert.equal(await takeHint(io, "/q"), true);
  assert.equal(await takeHint(io, "/q"), false);
  assert.deepEqual(await inspectRoot(io, "/p/notes"), { exists: true, lanes: ["deferred_work"], nested: "" });
  assert.deepEqual(await inspectRoot(io, "/p/other"), { exists: false, lanes: [] });
  assert.equal(await createRoot(io, "/p/other"), true);
  assert.equal(proposedRoot("/p"), "/p/notes");
});

test("typed locations resolve against the project and refuse escapes", () => {
  assert.equal(resolveLocation("/p", "notes2"), "/p/notes2");
  assert.equal(resolveLocation("/p", "/abs/dir/"), "/abs/dir");
  assert.equal(resolveLocation("/p", "a/../b"), "/p/b");
  assert.equal(resolveLocation("/p", "   "), null);
  assert.equal(resolveLocation("/", ".."), null);
});

test("edit replaces only the body; empty plain bodies are refused", () => {
  const { text, key } = appendPlainNote("legacy\n", { body: "old", sessionId: SESSION });
  const edited = editBody(text, key, "new\nbody");
  assert.equal(edited.ok, true);
  assert.ok(edited.text.startsWith("legacy\n"));
  const card = readCards(edited.text).find((c) => c.key === key);
  assert.equal(card.body, "new\nbody");
  assert.deepEqual(editBody(text, key, "  "), { ok: false, code: "EMPTY_CONTENT" });
  assert.deepEqual(editBody(text, "nope", "x"), { ok: false, code: "ITEM_UNRESOLVED" });
});

test("delete removes one note and keeps legacy text around it", () => {
  const a = appendPlainNote("before\n", { body: "a", sessionId: SESSION });
  const b = appendPlainNote(a.text, { body: "b", sessionId: SESSION });
  const out = deleteItem(b.text, a.key);
  assert.equal(out.ok, true);
  assert.deepEqual(readCards(out.text).map((c) => c.body), ["before", "b"]);
  assert.deepEqual(deleteItem(out.text, a.key), { ok: false, code: "ITEM_UNRESOLVED" });
  assert.equal(deleteItem(appendPlainNote("", { body: "x", sessionId: SESSION, key: "k" }).text, "k").text, "");
});

test("edit and delete are refused on a stale version; overwrite re-applies to the latest", async () => {
  const io = fakeIo({ dirs: ["/p/notes"] });
  const base = { root: "/p/notes", lane: "conversation_todo", sessionId: SESSION };
  const one = await addPlainNote(io, { ...base, body: "one" });
  const path = lanePath("/p/notes", "conversation_todo", SESSION);
  const seen = await readLane(io, path);
  await addPlainNote(io, { ...base, body: "two" });
  const stale = await editNote(io, { ...base, key: one.key, expected: seen.version, body: "ONE" });
  assert.equal(stale.code, "STALE");
  assert.equal((await deleteNote(io, { ...base, key: one.key, expected: seen.version })).code, "STALE");
  const forced = await editNote(io, { ...base, key: one.key, expected: seen.version, body: "ONE", overwrite: true });
  assert.equal(forced.ok, true);
  assert.deepEqual(readCards(io.files.get(path)).map((c) => c.body), ["ONE", "two"]);
  const fresh = await readLane(io, path);
  assert.equal((await deleteNote(io, { ...base, key: one.key, expected: fresh.version })).ok, true);
  assert.deepEqual(readCards(io.files.get(path)).map((c) => c.body), ["two"]);
});

test("the editor header is dropped on read-back, and only when still there", () => {
  const header = "✎ write below";
  const file = editorFile(header, "line one\n\nline three");
  assert.equal(editorBody(header, file), "line one\n\nline three");
  assert.equal(editorBody(header, `${file}\n`), "line one\n\nline three");
  assert.equal(editorBody(header, "user removed the header"), "user removed the header");
  assert.equal(editorBodyFromHeaders(["English header", "中文标题"], editorFile("中文标题", "body")), "body");
});

test("editor paths encode untrusted item keys and stay inside .editing", async () => {
  const key = "x/../../../victim.txt;$`'’";
  const path = await editorPath("/project/notes", "session-", key);
  assert.match(path, /^\/project\/notes\/\.editing\/session-x_+.*-[0-9a-f]{12}\.txt$/);
  assert.equal(assertEditorPath("/project/notes", path), path);
  assert.throws(() => assertEditorPath("/project/notes", "/project/victim.txt"), /outside/);
});

test("editor commits keep their own expected version and advance only on success", () => {
  const original = { lane: "conversation_todo", key: "k", expected: "opened", mode: "editor", synced: "old", observed: "old" };
  assert.deepEqual(editorWriteArgs(original, "draft"), { key: "k", expected: "opened", body: "draft" });
  assert.equal(editorCanFinish({ ...original, observed: "uncommitted" }), false);
  const failedDraft = editorObservedState(original, "uncommitted");
  assert.deepEqual([failedDraft.observed, failedDraft.synced, failedDraft.expected], ["uncommitted", "old", "opened"]);
  assert.equal(editorCanFinish({ ...original, mode: "new", observed: "", synced: "" }), false);
  const committed = editorCommittedState(original, "draft", "returned-version");
  assert.deepEqual([committed.expected, committed.synced, committed.observed], ["returned-version", "draft", "draft"]);
  assert.equal(editorCanFinish(committed), true);
});

test("editor sync may write only while its generation and editor identity still match", () => {
  const editor = { lane: "conversation_todo", key: "k", mode: "editor", path: "/notes/.editing/k.txt" };
  assert.equal(editorSyncCanWrite(4, 4, editor, { ...editor }), true);
  assert.equal(editorSyncCanWrite(4, 5, editor, { ...editor }), false);
  assert.equal(editorSyncCanWrite(4, 4, editor, null), false);
  assert.equal(editorSyncCanWrite(4, 4, editor, { ...editor, path: "/notes/.editing/other.txt" }), false);
});

test("a missing editor closes only when no text is uncommitted; successful new saves clear state before cleanup", () => {
  assert.equal(editorMissingFinish({ observed: "saved", synced: "saved" }), "close");
  assert.equal(editorMissingFinish({ observed: "draft", synced: "saved" }), "keep");
  assert.deepEqual(savedNewEditorCleanup({ mode: "new", path: "/p/notes/.editing/draft.txt" }), {
    state: null,
    path: "/p/notes/.editing/draft.txt",
  });
});

test("a write cancelled at the last moment leaves the lane as it was", async () => {
  const { writeLane } = await import("../hooks/lib/store.js");
  const files = new Map([["/r", ""], ["/r/conversation_todo/s.md", "old\n"]]);
  const io = {
    exists: async (p) => files.has(p),
    read: async (p) => files.get(p),
    write: async (p, t) => { files.set(p, t); },
    moveFile: async (a, b) => { files.set(b, files.get(a)); files.delete(a); return { exitCode: 0, stderr: "" }; },
    removeFile: async (p) => { files.delete(p); return { exitCode: 0 }; },
  };
  const { versionOf } = await import("../hooks/lib/notes.js");
  let wanted = true;
  const pending = writeLane(io, "/r", "/r/conversation_todo/s.md", await versionOf("old\n"), "discarded\n", () => wanted);
  wanted = false;
  const result = await pending;
  assert.equal(result.code, "EDITOR_CANCELED");
  assert.equal(files.get("/r/conversation_todo/s.md"), "old\n");
  assert.equal([...files.keys()].some((k) => k.endsWith(".tmp")), false);
});

test("setup points to a notes folder one level down when the chosen folder has none", async () => {
  const { inspectRoot } = await import("../hooks/lib/store.js");
  const tree = { "/p": ["notes", "src"], "/p/notes": ["conversation_todo"] };
  const io = {
    exists: async (p) => p in tree || p === "/p",
    stat: async () => ({ kind: "dir" }),
    list: async (p) => (tree[p] ?? []).map((name) => ({ name, kind: "dir" })),
  };
  const info = await inspectRoot(io, "/p");
  assert.deepEqual([info.lanes, info.nested], [[], "/p/notes"]);
  assert.equal((await inspectRoot(io, "/p/notes")).nested, "");
});
