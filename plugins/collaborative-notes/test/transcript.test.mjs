// Transcript model, quote location and quoted notes. Run: node --test test/
import assert from "node:assert/strict";
import { test } from "node:test";

import { appendSourcedNote, readCards } from "../hooks/lib/notes.js";
import { findQuote, highlightRuns, parseLines, searchTurns, sentenceRange, sentences, toTurns, turnSummary } from "../hooks/lib/transcript.js";
import { locate } from "../hooks/lib/visible.js";

const S1 = "0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b";
const row = (o) => JSON.stringify({ sessionId: S1, timestamp: "2026-01-02T03:04:05Z", ...o });
const lines = [
  row({ type: "queue-operation", operation: "enqueue" }),
  row({ type: "user", uuid: "u1", message: { role: "user", content: "介绍一下中秋节" } }),
  row({ type: "assistant", uuid: "a1", message: { id: "msg_1", content: [{ type: "thinking", thinking: "x" }] } }),
  row({ type: "assistant", uuid: "a2", message: { id: "msg_1", content: [{ type: "text", text: "中秋节是**团圆**的节日。\n\n- 吃月饼\n- 赏月" }] } }),
  row({ type: "assistant", uuid: "a3", message: { id: "msg_1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } }),
  row({ type: "user", uuid: "r1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
  row({ type: "assistant", uuid: "a4", message: { id: "msg_1", content: [{ type: "text", text: "再说一次：团圆。" }] } }),
  row({ type: "user", uuid: "m1", isMeta: true, message: { role: "user", content: "meta" } }),
  row({ type: "user", uuid: "c1", message: { role: "user", content: "<command-name>/notes</command-name>" } }),
  row({ type: "user", uuid: "u2", message: { role: "user", content: [{ type: "text", text: "Second question" }] } }),
  row({ type: "assistant", uuid: "a5", message: { id: "msg_2", content: [{ type: "text", text: "Answer two" }] } }),
  "{not json",
];

test("text blocks keep uuid, session and render id; meta, tags and tool rows are skipped", () => {
  const blocks = parseLines(lines);
  assert.deepEqual(blocks.map((b) => b.uuid), ["u1", "a2", "a4", "u2", "a5"]);
  assert.deepEqual(blocks.map((b) => b.renderId), ["u1", "msg_1-t0", "msg_1-t1", "u2", "msg_2-t0"]);
  assert.equal(blocks[1].sessionId, S1);
});

test("incremental parsing keeps the per-message text counter", () => {
  const tIndex = new Map();
  const first = parseLines(lines.slice(0, 5), tIndex);
  const rest = parseLines(lines.slice(5), tIndex);
  assert.deepEqual([...first, ...rest].map((b) => b.renderId), ["u1", "msg_1-t0", "msg_1-t1", "u2", "msg_2-t0"]);
});

test("turns group blocks under each prompt, with a summary", () => {
  const turns = toTurns(parseLines(lines));
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0].blocks.map((b) => b.uuid), ["u1", "a2", "a4"]);
  assert.deepEqual(turnSummary(turns[0]), { prompt: "介绍一下中秋节", answer: "中秋节是**团圆**的节日。 - 吃月饼 - 赏月" });
});

test("a copied selection is found on visible text, newest first, all messages listed", () => {
  const blocks = parseLines(lines);
  const one = findQuote(blocks, "中秋节是团圆的节日。\n吃月饼");
  assert.deepEqual(one.map((f) => f.block.uuid), ["a2"]);
  const two = findQuote(blocks, "团圆");
  assert.deepEqual(two.map((f) => f.block.uuid), ["a4", "a2"]);
  assert.deepEqual(findQuote(blocks, "not in this conversation"), []);
});

test("highlight marks every match in the visible text", () => {
  const { lines: rows, matches } = highlightRuns("团圆 and **团圆**", "团圆");
  assert.equal(matches, 2);
  assert.deepEqual(rows[0], [{ text: "团圆", mark: true }, { text: " and ", mark: false }, { text: "团圆", mark: true }]);
});

test("conversation search returns turn, role and context", () => {
  const hits = searchTurns(toTurns(parseLines(lines)), "answer");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].turn, 1);
  assert.equal(hits[0].match, "Answer");
  assert.equal(hits[0].prompt, "Second question");
  assert.deepEqual(searchTurns(toTurns(parseLines(lines)), "a"), []);
});

test("a quoted note stores S, the source identity and an optional body", () => {
  const source = { sessionId: S1, messageId: "a2" };
  const { text, key } = appendSourcedNote("", { sessionId: S1, snapshot: "团圆\n吃月饼", source });
  assert.match(text, /dsh-meta kind: source-aware/);
  assert.match(text, /dsh-meta source-payload: \{"sessionId":"0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b","messageId":"a2"\}/);
  const [card] = readCards(text);
  assert.equal(card.key, key);
  assert.equal(card.snapshot, "团圆\n吃月饼");
  assert.equal(card.body, "");
  assert.deepEqual(card.source, source);
  const withBody = readCards(appendSourcedNote("", { sessionId: S1, snapshot: "团圆", source, body: "why it matters" }).text)[0];
  assert.equal(withBody.body, "why it matters");
  assert.equal(withBody.snapshot, "团圆");
});

test("sentences split visible text at sentence ends and line breaks", () => {
  const md = "第一句。第二句**加粗**！\n\n- 列表项一\n- 列表项二\nEnd. Done";
  const { list } = sentences(md);
  assert.deepEqual(list.map((x) => x.text), ["第一句。", "第二句加粗！", "列表项一", "列表项二", "End.", "Done"]);
});

test("a sentence range is exact visible text and verifies against the message", () => {
  const md = "第一句。第二句**加粗**！\n\n- 列表项一\n- 列表项二";
  const s = sentenceRange(md, 1, 3);
  assert.equal(s, "第二句加粗！\n\n列表项一\n列表项二");
  assert.equal(sentenceRange(md, 3, 1), s);
  assert.equal(locate(md, s).ranges.length, 1);
  assert.equal(sentenceRange(md, 0, 9), "");
});

test("a copied text found in several messages lists each with its turn and context", async () => {
  const { pasteHits } = await import("../hooks/lib/transcript.js");
  const hits = pasteHits(toTurns(parseLines(lines)), "团圆");
  assert.deepEqual(hits.map((hit) => [hit.uuid, hit.turn, hit.matches]), [["a2", 0, 1], ["a4", 0, 1]]);
  assert.equal(hits[0].match, "团圆");
  assert.equal(hits[0].before, "中秋节是");
  assert.equal(hits[0].prompt, "介绍一下中秋节");
});

test("a copy with curly quotes matches the straight quotes of the source", () => {
  const md = "| G1 | it's been \"closed\" | Missing |";
  assert.equal(locate(md, "it’s been “closed”\tMissing").ranges.length, 1);
});

test("emphasis markers the app shows as text still match", () => {
  const md = "| 1 | **功能对照：**逐条对比 Codex README | x |";
  assert.equal(locate(md, "**功能对照：**逐条对比 Codex README").ranges.length, 1);
  assert.equal(locate(md, "功能对照：逐条对比 Codex README").ranges.length, 0);
});

test("visible projection strips paired emphasis and keeps literal asterisks", async () => {
  const { project } = await import("../hooks/lib/visible.js");
  assert.equal(project("**加粗**").text, "加粗");
  assert.equal(project("a * b").text, "a * b");
  assert.equal(locate("a * b", "a b").ranges.length, 0);
});

test("CommonMark emphasis preserves literal delimiters and consumes unequal runs", async () => {
  const { project } = await import("../hooks/lib/visible.js");
  const fixtures = [
    ["**bold and *italic***", "bold and italic"],
    ["a\\*b*c", "a*b*c"],
    ["a**+b**c", "a**+b**c"],
    ["**加粗**", "加粗"],
    ["**功能对照：**逐条对比", "**功能对照：**逐条对比"],
    ["a * b", "a * b"],
    ["*a*", "a"],
    ["_a_b", "_a_b"],
    ["***x***", "x"],
    ["**a** **b**", "a b"],
    ["`*opaque*` *visible*", "*opaque* visible"],
    ["``*opaque* `ticks` opaque`` *visible*", "*opaque* `ticks` opaque visible"],
  ];
  for (const [source, visible] of fixtures) {
    const result = project(source);
    assert.equal(result.text, visible, source);
    assert.equal(result.map.length, result.text.length, source);
    assert.ok(result.map.every((index) => Number.isInteger(index) && index >= 0 && index < source.length), source);
  }
  const alphabet = ["*", "_", "\\", "`", "a", "b", " ", "："];
  let seed = 0x5eed;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let sample = 0; sample < 5000; sample += 1) {
    let source = "";
    const length = Math.floor(random() * 48);
    for (let index = 0; index < length; index += 1) source += alphabet[Math.floor(random() * alphabet.length)];
    const result = project(source);
    assert.equal(result.map.length, result.text.length, `fuzz sample ${sample}: ${source}`);
  }
});

test("CommonMark 0.31.2 emphasis examples 350-480 project visible text and exact copies", async () => {
  const { project } = await import("../hooks/lib/visible.js");
  const fixtures = [
    { markdown: "*foo*", expected: "foo" },
    { markdown: "_foo_", expected: "foo" },
    { markdown: "**foo**", expected: "foo" },
    { markdown: "__foo__", expected: "foo" },
    { markdown: "***foo***", expected: "foo" },
    { markdown: "___foo___", expected: "foo" },
    { markdown: "**foo *bar* baz**", expected: "foo bar baz" },
    { markdown: "*foo **bar***", expected: "foo bar" },
    { markdown: "**foo *bar***", expected: "foo bar" },
    { markdown: "*foo **bar* baz**", expected: "foo bar baz" },
    { markdown: "*foo **bar *baz* bim** bop*", expected: "foo bar baz bim bop" },
    { markdown: "foo******bar*********baz", expected: "foobar***baz" }, // CommonMark 417
    { markdown: "*foo _bar* baz_", expected: "foo _bar baz_" }, // CommonMark 469
    { markdown: "*foo [*bar*](/url)*", expected: "foo bar" },
    { markdown: "[*foo*](/url)", expected: "foo" },
    { markdown: "[**foo _bar_**](/url)", expected: "foo bar" },
    { markdown: "*[foo](url)*", expected: "foo" },
    { markdown: "foo_bar_baz", expected: "foo_bar_baz" },
    { markdown: "_foo_bar", expected: "_foo_bar" },
    { markdown: "__foo_bar__", expected: "foo_bar" },
    { markdown: "a_b_c", expected: "a_b_c" },
    { markdown: "a__b__c", expected: "a__b__c" },
    { markdown: "x * foo*", expected: "x * foo*" },
    { markdown: "*foo *", expected: "*foo *" },
    { markdown: "** foo**", expected: "** foo**" },
    { markdown: "**foo **", expected: "**foo **" },
    { markdown: "***foo** bar*", expected: "foo bar" },
    { markdown: "*foo **bar*** baz", expected: "foo bar baz" },
    { markdown: "**foo *bar*** baz", expected: "foo bar baz" },
    { markdown: "*foo *bar* baz*", expected: "foo bar baz" },
    { markdown: "**foo **bar baz**", expected: "**foo bar baz" },
    { markdown: "*foo *bar baz*", expected: "*foo bar baz" },
    { markdown: "a * b", expected: "a * b" },
    { markdown: "a ** b", expected: "a ** b" },
    { markdown: "a *** b", expected: "a *** b" },
    { markdown: "a\\*b*c", expected: "a*b*c" },
    { markdown: "\\*foo*", expected: "*foo*" },
    { markdown: "**a** **b**", expected: "a b" },
    { markdown: "*one* and _two_", expected: "one and two" },
    { markdown: "***one** two*", expected: "one two" },
    { markdown: "**one* two**", expected: "one two*" },
    { markdown: "foo *bar* baz", expected: "foo bar baz" },
    { markdown: "foo _bar_ baz", expected: "foo bar baz" },
    { markdown: "中文*强调*文本", expected: "中文强调文本" },
    { markdown: "中文_词_文本", expected: "中文_词_文本" },
    { markdown: "a**+b**c", expected: "a**+b**c" },
    { markdown: "`*opaque*` *visible*", expected: "*opaque* visible" },
    // CommonMark 0.31.2 emphasis examples in the requested 350–480 range.
    { markdown: "*foo bar*", expected: "foo bar" }, // 350
    { markdown: "a * foo bar*", expected: "a * foo bar*" }, // 351
    { markdown: "a*\"foo\"*", expected: "a*\"foo\"*" }, // 352
    { markdown: "* a *", expected: "* a *" }, // 353
    { markdown: "foo*bar*", expected: "foobar" }, // 355
    { markdown: "5*6*78", expected: "5678" }, // 356
    { markdown: "_foo bar_", expected: "foo bar" }, // 357
    { markdown: "_ foo bar_", expected: "_ foo bar_" }, // 358
    { markdown: "a_\"foo\"_", expected: "a_\"foo\"_" }, // 359
    { markdown: "foo_bar_", expected: "foo_bar_" }, // 360
    { markdown: "5_6_78", expected: "5_6_78" }, // 361
    { markdown: "пристаням_стремятся_", expected: "пристаням_стремятся_" }, // 362
    { markdown: "aa_\"bb\"_cc", expected: "aa_\"bb\"_cc" }, // 363
    { markdown: "foo-_(bar)_", expected: "foo-(bar)" }, // 364
    { markdown: "_foo*", expected: "_foo*" }, // 365
    { markdown: "*foo bar *", expected: "*foo bar *" }, // 366
    { markdown: "*(*foo)", expected: "*(*foo)" }, // 368
    { markdown: "*(*foo*)*", expected: "(foo)" }, // 369
    { markdown: "*foo*bar", expected: "foobar" }, // 370
    { markdown: "_foo bar _", expected: "_foo bar _" }, // 371
    { markdown: "_(_foo)", expected: "_(_foo)" }, // 372
    { markdown: "_(_foo_)_", expected: "(foo)" }, // 373
    { markdown: "_foo_bar", expected: "_foo_bar" }, // 374
    { markdown: "_пристаням_стремятся", expected: "_пристаням_стремятся" }, // 375
    { markdown: "_foo_bar_baz_", expected: "foo_bar_baz" }, // 376
    { markdown: "_(bar)_.", expected: "(bar)." }, // 377
    { markdown: "**foo bar**", expected: "foo bar" }, // 378
    { markdown: "** foo bar**", expected: "** foo bar**" }, // 379
    { markdown: "a**\"foo\"**", expected: "a**\"foo\"**" }, // 380
    { markdown: "foo**bar**", expected: "foobar" }, // 381
    { markdown: "__foo bar__", expected: "foo bar" }, // 382
    { markdown: "__ foo bar__", expected: "__ foo bar__" }, // 383
    { markdown: "a__\"foo\"__", expected: "a__\"foo\"__" }, // 385
    { markdown: "foo__bar__", expected: "foo__bar__" }, // 386
    { markdown: "5__6__78", expected: "5__6__78" }, // 387
    { markdown: "пристаням__стремятся__", expected: "пристаням__стремятся__" }, // 388
    { markdown: "__foo, __bar__, baz__", expected: "foo, bar, baz" }, // 389
    { markdown: "foo-__(bar)__", expected: "foo-(bar)" }, // 390
    { markdown: "**foo bar **", expected: "**foo bar **" }, // 391
    { markdown: "**(**foo)", expected: "**(**foo)" }, // 392
    { markdown: "*(**foo**)*", expected: "(foo)" }, // 393
    { markdown: "**Gomphocarpus (*Gomphocarpus physocarpus*, syn. *Asclepias physocarpa*)**", expected: "Gomphocarpus (Gomphocarpus physocarpus, syn. Asclepias physocarpa)" }, // 394
    { markdown: "**foo \"*bar*\" foo**", expected: "foo \"bar\" foo" }, // 395
    { markdown: "**foo**bar", expected: "foobar" }, // 396
    { markdown: "__foo bar __", expected: "__foo bar __" }, // 397
    { markdown: "__(__foo)", expected: "__(__foo)" }, // 398
    { markdown: "_(__foo__)_", expected: "(foo)" }, // 399
    { markdown: "__foo__bar", expected: "__foo__bar" }, // 400
    { markdown: "__пристаням__стремятся", expected: "__пристаням__стремятся" }, // 401
    { markdown: "__foo__bar__baz__", expected: "foo__bar__baz" }, // 402
    { markdown: "__(bar)__.", expected: "(bar)." }, // 403
    { markdown: "_foo __bar__ baz_", expected: "foo bar baz" }, // 406
    { markdown: "_foo _bar_ baz_", expected: "foo bar baz" }, // 407
    { markdown: "__foo_ bar_", expected: "foo bar" }, // 408
    { markdown: "*foo *bar**", expected: "foo bar" }, // 409
    { markdown: "*foo **bar** baz*", expected: "foo bar baz" }, // 410
    { markdown: "*foo**bar**baz*", expected: "foobarbaz" }, // 411
    { markdown: "*foo**bar*", expected: "foo**bar" }, // 412
    { markdown: "***foo** bar*", expected: "foo bar" }, // 413
    { markdown: "*foo **bar***", expected: "foo bar" }, // 414
    { markdown: "*foo**bar***", expected: "foobar" }, // 415
    { markdown: "foo***bar***baz", expected: "foobarbaz" }, // 416
    { markdown: "*foo **bar *baz* bim** bop*", expected: "foo bar baz bim bop" }, // 418
    { markdown: "*foo [*bar*](/url)*", expected: "foo bar" }, // 419
    { markdown: "** is not an empty emphasis", expected: "** is not an empty emphasis" }, // 420
    { markdown: "**** is not an empty strong emphasis", expected: "**** is not an empty strong emphasis" }, // 421
  ];
  assert.ok(fixtures.length >= 40);
  for (const { markdown, expected } of fixtures) {
    const projected = project(markdown);
    assert.equal(projected.text, expected, markdown);
    assert.equal(projected.map.map(index => markdown[index]).join(""), expected, `source map: ${markdown}`);
    assert.ok(locate(markdown, expected).ranges.length >= 1, `correct copy: ${markdown}`);
  }
  assert.equal(locate("foo******bar*********baz", "foobarbaz").ranges.length, 0);
  assert.equal(locate("*foo _bar* baz_", "foo bar baz").ranges.length, 0);
});
