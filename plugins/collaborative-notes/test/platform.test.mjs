import assert from "node:assert/strict";
import { test } from "node:test";

import {
  childFolder, clipboard, isAbsolutePath, isRootPath, makeDir, makeDirs, moveFile, normalizePath,
  openInEditor, openLink, parentFolder, readAll, readFrom, removeFile, systemLanguage, tempFile,
  trimFolderPath,
} from "../hooks/lib/platform.js";
import { resolveLocation } from "../hooks/lib/store.js";

test("macOS commands keep their existing argv and environment", () => {
  assert.deepEqual(removeFile("/tmp/a b"), { argv: ["rm", "-f", "/tmp/a b"] });
  assert.deepEqual(makeDirs("/tmp/a"), { argv: ["mkdir", "-p", "/tmp/a"] });
  assert.deepEqual(makeDir("/tmp/a"), { argv: ["mkdir", "/tmp/a"] });
  assert.deepEqual(moveFile("/tmp/a", "/tmp/b"), { argv: ["mv", "-f", "/tmp/a", "/tmp/b"] });
  assert.deepEqual(readFrom("/tmp/a", 4), { argv: ["tail", "-c", "+5", "/tmp/a"] });
  assert.deepEqual(readAll("/tmp/a"), { argv: ["cat", "/tmp/a"] });
  assert.deepEqual(clipboard(), { argv: ["pbpaste"], env: { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" } });
  assert.deepEqual(openLink("claude://session"), { argv: ["open", "claude://session"] });
  assert.deepEqual(tempFile("collaborative-note"), { argv: ["mktemp", "-t", "collaborative-note"] });
  assert.deepEqual(openInEditor("/tmp/a"), { argv: ["open", "-t", "/tmp/a"] });
  assert.deepEqual(systemLanguage(), { argv: ["defaults", "read", "-g", "AppleLanguages"] });
});

test("Windows operations use PowerShell with UTF-8 output or Notepad started without waiting", () => {
  const commands = [
    removeFile("C:/a", true), makeDirs("C:/a", true), makeDir("C:/a", true), moveFile("C:/a", "C:/b", true),
    readFrom("C:/a", 3, true), readAll("C:/a", true), clipboard(true), openLink("claude://session", true),
    tempFile("collaborative-note", true), systemLanguage(true),
  ];
  for (const result of commands) {
    assert.equal(result.argv[0], "powershell");
    assert.deepEqual(result.argv.slice(1, 3), ["-NoProfile", "-NonInteractive"]);
    assert.equal(result.argv[3], "-Command");
    assert.match(result.argv[4], /^\[Console\]::OutputEncoding = \[Text\.Encoding\]::UTF8;/);
  }
  const editor = openInEditor("C:/a b/note.txt", true);
  assert.equal(editor.env.CN_ARG1, "C:/a b/note.txt");
  assert.match(editor.argv.at(-1), /Start-Process -FilePath 'notepad\.exe' -ArgumentList/);
  assert.equal(editor.argv.at(-1).includes("C:/a b/note.txt"), false);
  assert.match(makeDir("C:/a", true).argv[4], /Directory already exists/);
  assert.match(makeDirs("C:/a", true).argv[4], /CreateDirectory/);
  assert.match(readFrom("C:/a", 3, true).argv[4], /OpenStandardOutput\(\)\.Write/);
});

test("PowerShell receives hostile path data through environment, never script source", () => {
  const path = "C:/Users/O’Neil/a ' \" $ ` ; folder/note.txt";
  const result = readAll(path, true);
  assert.equal(result.env.CN_ARG1, path);
  assert.equal(result.argv[4].includes(path), false);
  assert.match(result.argv[4], /ReadAllText\(\$env:CN_ARG1/);
  const linked = openLink("claude://x ' ; $ ` ”", true);
  assert.equal(linked.env.CN_ARG1, "claude://x ' ; $ ` ”");
  assert.equal(linked.argv[4].includes("claude://"), false);
  const moved = moveFile(path, "C:/other ’ $ ` ;.txt", true);
  assert.deepEqual([moved.env.CN_ARG1, moved.env.CN_ARG2], [path, "C:/other ’ $ ` ;.txt"]);
  assert.equal(moved.argv[4].includes("O’Neil"), false);
});

test("Windows and POSIX path helpers handle drive roots", () => {
  assert.equal(normalizePath("C:\\Users\\a b\\proj"), "C:/Users/a b/proj");
  assert.equal(normalizePath("/Users/a\\b"), "/Users/a\\b");
  assert.equal(isAbsolutePath("C:\\Users\\a b\\proj"), true);
  assert.equal(trimFolderPath("C:/"), "C:/");
  assert.equal(isRootPath("C:/"), true);
  assert.equal(parentFolder("C:/"), "C:/");
  assert.equal(parentFolder("C:/Users"), "C:/");
  assert.equal(childFolder("C:/", "a b"), "C:/a b");
  assert.equal(parentFolder("/Users/x"), "/Users");
  assert.equal(resolveLocation("C:/Users/a b/proj", "notes"), "C:/Users/a b/proj/notes");
  assert.equal(resolveLocation("C:/Users/a b/proj", "C:\\"), "C:/");
  assert.equal(resolveLocation("/Users/x", "../notes"), "/Users/notes");
});
