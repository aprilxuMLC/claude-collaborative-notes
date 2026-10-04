// Copied from aprilxuMLC/codex-work-collaborative-notes v0.8.8 server/lib/carry.js (MIT).
// Additions below the copy: forkParent, planLane, holdsAnyKey.

import { getItemKey, parseLaneBody, serializeLaneBody, withItemKey, newItemKey } from "./structured-item.js";

/**
 * Fork-cut eligibility (Core §8.1.1), decided by host history membership:
 * - no source → eligible;
 * - source message inherited by the child → before the cut → eligible;
 * - source message in the parent's history (incl. ancestors) but not in the
 *   child → after the cut → excluded;
 * - source in neither history → not comparable → eligible (never silently
 *   excluded).
 */
export function sourceEligible(item, parentThreadId, childItemIds, parentItemIds = new Set()) {
  const source = item?.sourcePayload;
  if (!source || typeof source.messageId !== "string") return true;
  if (childItemIds.has(source.messageId)) return true;
  if (parentItemIds.has(source.messageId)) return false;
  return true;
}

export function filterEligibleBody(body, { parentThreadId, childItemIds, parentItemIds }) {
  const parsed = parseLaneBody(String(body ?? ""));
  const kept = parsed.nodes.filter((node) => node.type !== "item" || sourceEligible(node.item, parentThreadId, childItemIds, parentItemIds));
  return kept.length === parsed.nodes.length
    ? String(body ?? "")
    : kept.length === 0 ? "" : serializeLaneBody({ nodes: kept, trailingNewline: parsed.trailingNewline });
}

export function rekeyCarriedBody(body) {
  const parsed = parseLaneBody(String(body ?? ""));
  const carriedKeys = [];
  const nodes = parsed.nodes.map((node) => {
    if (node.type !== "item") return node;
    const key = newItemKey();
    carriedKeys.push(key);
    return { ...node, item: withItemKey(node.item, key) };
  });
  return { body: nodes.length ? serializeLaneBody({ nodes, trailingNewline: parsed.trailingNewline }) : "", carriedKeys };
}

function structuredOnly(body) {
  return parseLaneBody(String(body ?? "")).nodes.every((node) => node.type === "item");
}

export function mergeCarryBodies(parentBody, childBody) {
  const parent = String(parentBody ?? "");
  const child = String(childBody ?? "");
  if (!parent.trim()) return child;
  if (!child.trim()) return parent;
  if (structuredOnly(parent) && structuredOnly(child)) {
    const p = parseLaneBody(parent);
    const c = parseLaneBody(child);
    return serializeLaneBody({
      nodes: [...p.nodes, ...c.nodes],
      trailingNewline: p.trailingNewline || c.trailingNewline,
    });
  }
  return `## Parent branch\n\n${parent}\n\n---\n\n## Current branch\n\n${child}`;
}

export function carryMarker(parentThreadId, lanes, status = "decided", { choice, selectedLanes } = {}) {
  return {
    version: 2,
    parentThreadId,
    status,
    decidedAt: status === "decided" ? new Date().toISOString() : null,
    lanes,
    ...(choice ? { choice } : {}),
    ...(Array.isArray(selectedLanes) ? { selectedLanes } : {}),
  };
}

// ---- additions for Claude ---------------------------------------------------

// The parent of a fork: the last session id in its transcript that is not its
// own (a fork's file starts with the parent's entries under the parent's id).
export function forkParent(sessionIds, own) {
  for (let i = sessionIds.length - 1; i >= 0; i -= 1) {
    if (sessionIds[i] && sessionIds[i] !== own) return sessionIds[i];
  }
  return null;
}

const itemCount = (text) => parseLaneBody(String(text ?? "")).nodes.filter((node) => node.type === "item").length;

// One lane's carry: what the child lane becomes. `mode` decides a lane the
// child already uses: "merge" (parent first), "keep" or "replace".
export function planLane({ parentText, childText, childItemIds, parentItemIds, mode = null }) {
  const eligible = filterEligibleBody(parentText, { childItemIds, parentItemIds });
  const offered = itemCount(eligible);
  const skipped = itemCount(parentText) - offered;
  const child = String(childText ?? "");
  const occupied = child.trim().length > 0;
  if (occupied && !mode) return { needsChoice: true, offered, skipped };
  if (offered === 0 || mode === "keep") return { text: child, carriedKeys: [], outcome: occupied ? "kept" : "copied", carried: 0, skipped };
  const { body, carriedKeys } = rekeyCarriedBody(eligible);
  if (!occupied) return { text: body, carriedKeys, outcome: "copied", carried: carriedKeys.length, skipped };
  if (mode === "replace") return { text: body, carriedKeys, outcome: "replaced", carried: carriedKeys.length, skipped };
  return { text: mergeCarryBodies(body, child), carriedKeys, outcome: "merged", carried: carriedKeys.length, skipped };
}

// Whether any planned item reached the child lane before an interruption.
export function holdsAnyKey(text, keys) {
  if (keys.length === 0) return false;
  const held = new Set(parseLaneBody(String(text ?? "")).nodes.filter((node) => node.type === "item").map((node) => getItemKey(node.item)));
  return keys.some((key) => held.has(key));
}

export function laneAlreadyHandled(markerLane, childText) {
  const keys = Array.isArray(markerLane?.carriedKeys) ? markerLane.carriedKeys : [];
  if (markerLane?.committed === true || holdsAnyKey(childText, keys)) return "committed";
  if (keys.length > 0) return "ambiguous";
  return "open";
}

export function resetCarryLane(markerLane) {
  return { ...markerLane, outcome: "pending", carriedKeys: [], committed: false };
}
