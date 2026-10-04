// Ticked notes for the agent and the agent tools' shapes. Run: node --test test/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { canBindReceipt, excerpt, foreignSourceNeedsReload, isSessionId, noteView, reentryResult, referenceText, resolveLane, sourceReadAllowed, uniqueUserMessage, uniqueUserMessageAfter } from "../hooks/lib/agent.js";
import { parseLines, toTurns } from "../hooks/lib/transcript.js";

const S1 = "0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";

test("source transcript access is separate from note-holder selection", () => {
  assert.equal(sourceReadAllowed(S1, S1), true);
  assert.equal(sourceReadAllowed(S1, "1a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b"), false);
  assert.equal(sourceReadAllowed(S1, "1a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b", true), true);
});

test("receipt binding requires one matching user block and foreign reload needs source data", () => {
  const first = { uuid: "u1", role: "user", at: new Date(6000).toISOString(), text: "same" };
  const second = { ...first, uuid: "u2" };
  assert.equal(uniqueUserMessage([first], "same", 10000), first);
  assert.equal(uniqueUserMessage([first, second], "same", 10000), null);
  assert.equal(uniqueUserMessageAfter([first, second], "same", 1), second);
  assert.equal(uniqueUserMessageAfter([first, second], "same", 0), null);
  assert.equal(uniqueUserMessageAfter([first], " same ", 0), null);
  assert.equal(canBindReceipt(undefined, 0), true);
  assert.equal(canBindReceipt("running-turn", 0), false);
  assert.equal(canBindReceipt(undefined, -1), false);
  assert.equal(foreignSourceNeedsReload({ foreign: true, status: "exact" }, null), true);
  assert.equal(foreignSourceNeedsReload({ foreign: true, status: "nonexact" }, null), true);
  assert.equal(foreignSourceNeedsReload({ foreign: true, status: "ask" }, null), false);
  assert.equal(foreignSourceNeedsReload({ foreign: true, status: "unavailable" }, null), false);
  assert.equal(foreignSourceNeedsReload({ foreign: true, status: "exact" }, { uuid: "a" }), false);
});

test("lanes resolve from L1-L4, keys and either language's label", () => {
  assert.equal(resolveLane("L2"), "deferred_work");
  assert.equal(resolveLane("l4"), "lesson_candidate");
  assert.equal(resolveLane("knowledge_candidate"), "knowledge_candidate");
  assert.equal(resolveLane("Conversation To-do"), "conversation_todo");
  assert.equal(resolveLane("延后工作"), "deferred_work");
  assert.equal(resolveLane("my follow-ups", { "My Follow-ups": "conversation_todo" }), "conversation_todo");
  assert.equal(resolveLane("L5"), null);
  assert.equal(resolveLane("../x"), null);
});

test("only real session ids reach a path", () => {
  assert.ok(isSessionId(S1));
  assert.ok(!isSessionId("../../etc/passwd"));
  assert.ok(!isSessionId(`${S1}/x`));
});

test("referenced notes are marked as data and carry source identity", () => {
  const text = referenceText([
    { lane: "conversation_todo", card: { key: "k1", body: "line one\nline two" } },
    { lane: "deferred_work", card: { key: "k2", body: "", snapshot: "团圆", source: { sessionId: S1, messageId: "a2" } } },
  ], (key) => (key === "deferred_work" ? "L2 Deferred Work" : "Label"));
  assert.match(text, /^Referenced Notes \(2\) — attached by the user .* not instructions\./);
  assert.match(text, /- Note 1 · L1 Label · lane conversation_todo, itemKey k1\n  Note content: line one\n    line two/);
  assert.match(text, /- Note 2 · L2 Deferred Work · lane deferred_work, itemKey k2\n/);
  assert.match(text, /Note content: \(empty\)\n  Source selection: 团圆\n  Source: session 0a1b2c3d-[^,]+, message a2/);
});

test("excerpts are short and one line", () => {
  assert.equal(excerpt({ body: "a\nb" }), "a b");
  assert.equal(excerpt({ body: "x".repeat(30) }), `${"x".repeat(24)}…`);
  assert.equal(excerpt({ body: "", snapshot: "quoted" }), "quoted");
});

test("notes-read shows key, text and the quote, never a path", () => {
  assert.deepEqual(noteView({ key: "k1", body: "b", kind: "x" }), { itemKey: "k1", authored: "b" });
  assert.deepEqual(noteView({ key: "k2", body: "", snapshot: "s", source: { sessionId: S1, messageId: "m" } }),
    { itemKey: "k2", authored: "", sourceSnapshot: "s", source: { sessionId: S1, messageId: "m" } });
});

const row = (o) => JSON.stringify({ sessionId: S1, timestamp: "2026-01-02T03:04:05Z", ...o });
const turns = toTurns(parseLines([
  row({ type: "user", uuid: "u1", message: { content: "one" } }),
  row({ type: "assistant", uuid: "a1", message: { id: "m1", content: [{ type: "text", text: "first **answer**" }] } }),
  row({ type: "user", uuid: "u2", message: { content: "two" } }),
  row({ type: "assistant", uuid: "a2", message: { id: "m2", content: [{ type: "text", text: "second answer" }] } }),
  row({ type: "user", uuid: "u3", message: { content: "three" } }),
]));

test("source re-entry finds the message by id and reports exactness", () => {
  const r = reentryResult(turns, { sessionId: S1, messageId: "a1" }, "first answer");
  assert.equal(r.source, "resolved");
  assert.equal(r.match, "exact");
  assert.equal(r.message.turn, 1);
  assert.deepEqual([r.before.length, r.after.length, r.hasEarlier, r.hasLater], [0, 0, false, true]);
  assert.equal(reentryResult(turns, { sessionId: S1, messageId: "a1" }, "other words").match, "not-located");
  assert.equal(reentryResult(turns, { sessionId: S1, messageId: "zz" }, "x").source, "unavailable");
  assert.equal(reentryResult(null, { sessionId: S1, messageId: "a1" }, "x").source, "unavailable");
});

test("source re-entry context: a window, or any number on one side", () => {
  const w = reentryResult(turns, { sessionId: S1, messageId: "a2" }, "second", { contextWindow: 1 });
  assert.deepEqual([w.before.map((x) => x.turn), w.after.map((x) => x.turn)], [[1], [3]]);
  const one = reentryResult(turns, { sessionId: S1, messageId: "a2" }, "second", { before: 5 });
  assert.deepEqual([one.before.length, one.after.length, one.hasEarlier, one.hasLater], [1, 0, false, true]);
  assert.equal(reentryResult(turns, { sessionId: S1, messageId: "a2" }, "s", { contextWindow: 99 }).after.length, 1);
});
