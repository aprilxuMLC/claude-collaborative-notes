// Guards on the pane module's source. Run: node --test test/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../hooks/register.tsx", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../../../docs/claude-desktop-adapter.md", import.meta.url), "utf8");
const adapterZh = readFileSync(new URL("../../../docs/claude-desktop-adapter.zh-CN.md", import.meta.url), "utf8");

test("no variable named h: JSX compiles to h(...), a local h breaks drawing", () => {
  const shadows = source.match(/[(,]\s*h\s*[:,)=]|\b(?:const|let|var)\s+h\b|\bh\s*=>/g) ?? [];
  assert.deepEqual(shadows, []);
});

test("plain is never given a computed value: the host accepts plain only as true or absent", () => {
  assert.deepEqual(source.match(/\bplain=\{/g) ?? [], []);
});

test("concurrency documentation states the compare-and-swap race boundary", () => {
  assert.match(adapter, /changes made before a write is checked/);
  assert.match(adapter, /instant between the check and the move is not coordinated and can be lost/);
  assert.match(adapter, /only the plugin's own writers are coordinated in-process/);
  assert.match(adapterZh, /检查与移动之间/);
  assert.match(adapterZh, /更改可能丢失/);
});

test("Input onSubmit handlers do not pass the event on as an extra argument", () => {
  // onSubmit(value, e): a handler with optional parameters must be wrapped.
  assert.deepEqual(source.match(/onSubmit=\{save\}/g) ?? [], []);
});
