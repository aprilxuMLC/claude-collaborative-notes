// The conversation as Notes sees it: text blocks of user and assistant
// messages read from the session transcript (JSONL), grouped into turns.
// Pure functions; reading the file is the host's job (register.tsx).
import { locate, project } from "./visible.js";

// A user row that is not something the person typed: injected context,
// command records, reminders.
const TAGGED = /^\s*<[a-z][a-z0-9-]*[\s>]/i;

// Parse JSONL lines into text blocks, in file order. `tIndex` carries the
// per-message text-block counter across calls (incremental reads).
export function parseLines(lines, tIndex = new Map()) {
  const blocks = [];
  for (const line of lines) {
    if (!line || (!line.includes('"assistant"') && !line.includes('"user"'))) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const m = d?.message;
    if (!m || d.isMeta || d.isCompactSummary || (d.type !== "assistant" && d.type !== "user")) continue;
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }]
      : Array.isArray(m.content) ? m.content : [];
    for (const b of content) {
      if (b?.type !== "text" || typeof b.text !== "string" || !b.text.trim()) continue;
      if (d.type === "assistant") {
        const n = tIndex.get(m.id) ?? 0;
        tIndex.set(m.id, n + 1);
        blocks.push({
          uuid: d.uuid, sessionId: d.sessionId, role: "assistant", text: b.text,
          at: d.timestamp, renderId: `${m.id}-t${n}`,
        });
      } else {
        if (TAGGED.test(b.text)) continue;
        blocks.push({ uuid: d.uuid, sessionId: d.sessionId, role: "user", text: b.text, at: d.timestamp, renderId: d.uuid });
      }
    }
  }
  return blocks;
}

// Turns: each starts at a user block; blocks before the first user block
// form a turn of their own.
export function toTurns(blocks) {
  const turns = [];
  for (const block of blocks) {
    if (block.role === "user" || turns.length === 0) {
      turns.push({ index: turns.length, at: block.at, prompt: block.role === "user" ? block.text : "", blocks: [] });
    }
    turns[turns.length - 1].blocks.push(block);
  }
  return turns;
}

const oneLine = (text, n) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function turnSummary(turn, n = 80) {
  const answer = turn.blocks.find((b) => b.role === "assistant");
  return { prompt: oneLine(turn.prompt, n), answer: oneLine(answer?.text, n) };
}

// The visible text of a message cut into sentences: [{ start, end, text }]
// over project(text).text, end exclusive, surrounding whitespace left out.
// A sentence ends at 。！？；!?; a "." before a space, or a line break.
export function sentences(markdown) {
  const vis = project(markdown ?? "").text;
  const out = [];
  let start = -1;
  const close = (end) => {
    if (start < 0) return;
    let e = end;
    while (e > start && /\s/.test(vis[e - 1])) e -= 1;
    if (e > start) out.push({ start, end: e, text: vis.slice(start, e) });
    start = -1;
  };
  for (let i = 0; i < vis.length; i += 1) {
    const c = vis[i];
    if (c === "\n") { close(i); continue; }
    if (start < 0) { if (/\s/.test(c)) continue; start = i; }
    if ("。！？；!?;".includes(c) || (c === "." && (i + 1 >= vis.length || /\s/.test(vis[i + 1])))) close(i + 1);
  }
  close(vis.length);
  return { visible: vis, list: out };
}

// The exact visible text from sentence a to sentence b (either order).
export function sentenceRange(markdown, a, b) {
  const { visible, list } = sentences(markdown);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!list[lo] || !list[hi]) return "";
  return visible.slice(list[lo].start, list[hi].end);
}

// Blocks whose visible text contains S, newest first.
export function findQuote(blocks, s, limit = 8) {
  const found = [];
  for (let i = blocks.length - 1; i >= 0 && found.length < limit; i -= 1) {
    const ranges = locate(blocks[i].text, s).ranges;
    if (ranges.length > 0) found.push({ block: blocks[i], matches: ranges.length });
  }
  return found;
}

// Search the conversation (case-insensitive) for navigation only.
export function searchTurns(turns, query, limit = 30) {
  const q = String(query ?? "").trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = [];
  for (let t = turns.length - 1; t >= 0 && hits.length < limit; t -= 1) {
    for (const block of turns[t].blocks) {
      const lower = block.text.toLowerCase();
      const at = lower.indexOf(q);
      if (at < 0) continue;
      hits.push({
        turn: t, uuid: block.uuid, role: block.role,
        prompt: oneLine(turns[t].prompt, 60), at: block.at,
        before: oneLine(block.text.slice(Math.max(0, at - 40), at), 40),
        match: block.text.slice(at, at + q.length),
        after: oneLine(block.text.slice(at + q.length, at + q.length + 40), 40),
      });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

// Visible text of a block cut into lines of runs, marking every match of S.
export function highlightRuns(text, s) {
  const { vis, ranges } = locate(text, s ?? "");
  const marks = new Array(vis.text.length).fill(false);
  for (const [a, b] of ranges) for (let k = a; k <= b; k += 1) marks[k] = true;
  const lines = [[]];
  for (let k = 0; k < vis.text.length; k += 1) {
    if (vis.text[k] === "\n") { lines.push([]); continue; }
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (last && last.mark === marks[k]) last.text += vis.text[k];
    else line.push({ text: vis.text[k], mark: marks[k] });
  }
  return { lines, matches: ranges.length };
}

// Where a copied text S occurs (on visible text), oldest first: one entry per
// message, with the turn, the question that opened it, the first match with
// up to 40 characters around it, and how many matches the message has.
export function pasteHits(turns, s, limit = 50) {
  const hits = [];
  for (let t = 0; t < turns.length; t += 1) {
    for (const block of turns[t].blocks) {
      const { vis, ranges } = locate(block.text, s ?? "");
      if (ranges.length === 0) continue;
      const [a, b] = ranges[0];
      hits.push({
        turn: t, uuid: block.uuid, role: block.role, at: block.at,
        prompt: oneLine(turns[t].prompt, 60),
        before: oneLine(vis.text.slice(Math.max(0, a - 40), a), 40),
        match: vis.text.slice(a, b + 1),
        after: oneLine(vis.text.slice(b + 1, b + 41), 40),
        matches: ranges.length,
      });
    }
  }
  return hits.slice(-limit);
}
