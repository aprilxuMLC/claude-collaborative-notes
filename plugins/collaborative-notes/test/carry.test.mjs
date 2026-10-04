// Fork carry. Run: node --test test/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { carryMarker, forkParent, holdsAnyKey, laneAlreadyHandled, planLane, resetCarryLane } from "../hooks/lib/carry.js";
import { appendPlainNote, appendSourcedNote, readCards } from "../hooks/lib/notes.js";
import { getItemKey, parseLaneBody, serializeLaneBody } from "../hooks/lib/structured-item.js";

const P = "0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";
const C = "1a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";
const plain = (text, body) => appendPlainNote(text, { body, sessionId: P }).text;
const quoted = (text, messageId) => appendSourcedNote(text, { sessionId: P, snapshot: "s", source: { sessionId: P, messageId } }).text;

test("the parent is the last session id that is not the fork's own", () => {
  assert.equal(forkParent(["g", "p", "c"], "c"), "p");
  assert.equal(forkParent(["g", "p"], "c"), "p");
  assert.equal(forkParent(["c"], "c"), null);
  assert.equal(forkParent([], "c"), null);
});

const parentText = quoted(quoted(plain("", "one"), "before-cut"), "after-cut");
const ids = { childItemIds: new Set(["before-cut"]), parentItemIds: new Set(["before-cut", "after-cut"]) };

test("a source after the fork point is skipped; others get new keys", () => {
  const plan = planLane({ parentText, childText: "", ...ids });
  assert.equal(plan.outcome, "copied");
  assert.deepEqual([plan.carried, plan.skipped], [2, 1]);
  const cards = readCards(plan.text);
  assert.deepEqual(cards.map((c) => c.key), plan.carriedKeys);
  const parentKeys = readCards(parentText).map((c) => c.key);
  assert.ok(plan.carriedKeys.every((k) => !parentKeys.includes(k)));
  assert.equal(cards[1].source.messageId, "before-cut");
  assert.equal(cards[0].origin, P);
});

test("a lane the branch already uses asks first, then merges, keeps or replaces", () => {
  const childText = appendPlainNote("", { body: "mine", sessionId: C }).text;
  assert.equal(planLane({ parentText, childText, ...ids }).needsChoice, true);
  const merged = planLane({ parentText, childText, ...ids, mode: "merge" });
  assert.deepEqual(readCards(merged.text).map((c) => c.body), ["one", "", "mine"]);
  assert.equal(merged.outcome, "merged");
  const kept = planLane({ parentText, childText, ...ids, mode: "keep" });
  assert.deepEqual([kept.text, kept.outcome, kept.carried], [childText, "kept", 0]);
  const replaced = planLane({ parentText, childText, ...ids, mode: "replace" });
  assert.deepEqual(readCards(replaced.text).map((c) => c.body), ["one", ""]);
});

test("any planned key present means an interrupted lane must not be replanned", () => {
  const plan = planLane({ parentText, childText: "", ...ids });
  assert.ok(holdsAnyKey(plan.text, plan.carriedKeys));
  const firstKey = plan.carriedKeys[0];
  const partial = serializeLaneBody({
    nodes: parseLaneBody(plan.text).nodes.filter((node) => node.type === "item" && getItemKey(node.item) === firstKey),
    trailingNewline: true,
  });
  assert.ok(holdsAnyKey(partial, plan.carriedKeys));
  assert.ok(!holdsAnyKey("", plan.carriedKeys));
  assert.ok(!holdsAnyKey(plan.text, []));
});

test("carry recovery distinguishes committed, ambiguous and open lanes", () => {
  assert.equal(laneAlreadyHandled({ outcome: "copied", carriedKeys: ["k1"] }, ""), "ambiguous");
  assert.equal(laneAlreadyHandled({ outcome: "pending", carriedKeys: ["k1"], committed: false }, ""), "ambiguous");
  assert.equal(laneAlreadyHandled({ outcome: "copied", carriedKeys: ["k1"], committed: true }, ""), "committed");
  const plan = planLane({ parentText, childText: "", ...ids });
  assert.equal(laneAlreadyHandled({ outcome: "pending", carriedKeys: plan.carriedKeys }, plan.text), "committed");
  assert.equal(laneAlreadyHandled({ outcome: "pending", carriedKeys: [] }, ""), "open");
  assert.deepEqual(resetCarryLane({ outcome: "copied", carriedKeys: ["k1"], committed: false }), {
    outcome: "pending", carriedKeys: [], committed: false,
  });
});

test("the marker keeps the Codex format", () => {
  const m = carryMarker(P, { conversation_todo: { outcome: "copied", carriedKeys: ["k"], committed: true } }, "decided", { choice: "all" });
  assert.deepEqual(Object.keys(m), ["version", "parentThreadId", "status", "decidedAt", "lanes", "choice"]);
  assert.equal(m.version, 2);
  assert.equal(m.lanes.conversation_todo.committed, true);
});
