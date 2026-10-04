# Collaborative Notes — Claude Desktop Adapter Specification

**English** | [中文](claude-desktop-adapter.zh-CN.md)

> **Version:** 0.1.0 · Verified on macOS.
>
> **Scope:** how the `collaborative-notes` plugin realizes the Collaborative
> Notes [Core Contract](core-contract.md) in the **Code tab of the Claude
> desktop app**. Product semantics come from the Core Contract, the
> [Agent Guide](agent-guide.zh-CN.md), and the [Concept](concept.zh-CN.md).
> Host evidence is recorded in the [Claude capability map](claude/capability-map.md);
> adapter decisions are recorded in [Claude decisions](claude/decisions.md).

## 1. Host surfaces

- **Claude desktop Code tab.** This is the only claimed user-facing host. The
  plugin opens the host's native plugin pane, docked beside the conversation.
  It opens automatically in projects that have Notes set up. `/notes` opens
  it and starts setup in a new project; Claude can call `notes-open-panel`
  when the user asks. (P1–P2, I2)
- **Out of scope:** Claude Chat and Cowork have not been tried; plugin pane
  and function-hooks behavior there is not established. claude.ai web and
  mobile have not been tried with this plugin. Claude Code CLI and IDE
  sessions are not claimed as user-facing hosts because the native desktop
  pane is not established there. (P1–P3; capability map, “Not yet verified”)
- **Platforms:** verified on macOS. Windows code paths include PowerShell
  clipboard, file and link handling and drive-letter paths. CI unit tests and
  plugin validation passed on GitHub `windows-latest` and `macos-latest` on
  2026-10-04; this does not verify Claude desktop on Windows, which has not
  been tried. (§12)

## 2. Components

| Component | Role |
|---|---|
| **Function-hooks module** (`hooks/register.tsx`) | One plugin module registers the pane, transcript rendering, prompt submission, and agent tools. There is no service process or separate MCP server process. (P1, A2, I3) |
| **Skill** (`skills/collab-notes`) | Agent operating rules: user-led capture, truthful closure, no deletion tool, source re-entry, locality, and failure handling. |
| **Native plugin pane** | The host pane beside the conversation: lanes, quote capture and navigation, return to source, carry decisions, language switch, and help. It is not a browser page. (P2–P5, D1) |
| **Long-note editing** | Uses the app's file pane when the notes root is inside the session's project folder; otherwise uses the system text editor. The file pane auto-saves and each save is followed; text-editor changes are read back when the file is saved. (P15–P16, D3) |

Runtime uses the plugin's function-hooks API. There is no Notes service
process, MCP server process, or browser page. Agent tools are registered by
the plugin and handled by its `tool.call` hook. (A2, A4)

## 3. Identity and storage

- **Holder:** the current transcript session id, obtained from the session
  API and transcript entries. A quoted source is stored as
  `{sessionId, messageId}`, where `messageId` is the transcript entry `uuid`
  for the quoted text block. (Q3, Q6, I1)
- **Project:** the session's folder. Setup binds one notes root per project,
  defaulting to `<project>/notes`. The user can browse folders (Up, hidden
  folders listed last, New folder) or type a path. A missing configured root
  is reported and is never silently recreated. (D4; `hooks/register.tsx`)
- **Layout and format:** `<notes root>/<lane>/<sessionId>.md`, using
  `conversation_todo`, `deferred_work`, `knowledge_candidate`, and
  `lesson_candidate`. Files contain `dsh-note v1` blocks, item keys, and
  `dsh-meta host: claude`. (D4)
- **Lane display names:** global across projects and display-only; changing
  them never changes lane keys or files. Overrides are saved as `laneConfig`
  in the plugin store; setup asks for them. (D4; `hooks/register.tsx`)
- **Plugin store:** `~/.claude/plugins/store/` holds bindings, ticks, marks,
  language preference, and other plugin state. Note files stay in the
  project's notes root. Uninstalling leaves the note files and plugin store
  on disk. (P6, D4)
- **Fork marker:** `<notes root>/.carry-over/<child session id>.json`, in the
  Codex carry marker format version 2. (D10)

## 4. Source capture (Core §§2, 5; Decision D2)

- **Source identity:** `{sessionId, messageId, S}`, where `S` is the user's
  exact selected text and `messageId` is the transcript entry `uuid` for the
  text block. Every exact match is highlighted on return. (D2, Q3, I1)
- **Route 1 — copied text.** Select text in the native conversation, press
  ⌘C, then choose **📋 Quote copied text**, above the message box or in the
  pane. The plugin searches the whole conversation to locate it. One matching
  message is attached directly. If several messages match, they are shown
  like search results; open one and choose **Quote it from this message**.
  Reusing the same clipboard text as last time asks **Quote again?** The
  clipboard is never cleared. Conversation search is case-insensitive and
  only navigates to candidate messages; the stored quote is always the
  person's own copied selection, verified against the identified message.
  Only text in user and assistant messages is quotable, not reasoning, tool
  calls, tool output, or file changes. (Q4a, D1)
- **Route 2 — sentence picking.** Choose **🔍 Find in conversation**. The
  pane shows the latest 10 turns with summaries; load 20 earlier turns or
  search the whole conversation, including compacted parts. Open a turn, tap
  the first and last sentence, then choose **Quote selected text**. Picking
  stays within one message; picking in another message starts again. (Q4d)
- **Verification and exactness.** Pane text cannot be selected, and the host
  does not expose a sub-span selection from the native transcript (P8e, Q4).
  The selected text is checked against the visible-text projection of
  the identified transcript block; matching tolerates curly quotes and
  visible `**` markers. Search is case-insensitive and navigation only;
  quote identity still comes from the person's own selection or copied text, verified
  against that message. If no match is found, the pane reports it and suggests a shorter plain-text selection
  or search. Neither route creates a conversation turn. (Q2, Q4a–Q4b, D2)

## 5. Return to source (Core §§5, 8)

- **Human:** return-to-source opens in the Notes pane because Claude does not
  let the plugin scroll the native transcript to a message (Q4c). It shows
  the note, the quote, and the quoted turn alone by default, highlighting only
  when the quote matches exactly; otherwise it shows the whole message without
  a highlight. Earlier and later turns can be opened without a fixed limit.
  It reports **exact**, **not exact**, or **unavailable**; when unavailable,
  the saved quote remains visible. For an assistant
  source in the current conversation, the native message also receives a
  temporary yellow frame. (Q4b–Q4c; `hooks/register.tsx`)
- A source in another conversation is confirmed first. **↗ Open the original
  conversation** is offered only when the app confirms it knows that
  conversation. App session ids often differ from transcript ids, so this
  navigation is partial. (Q6, H1, H6, `hooks/register.tsx`)
- **Agent:** `notes-source-reentry` returns source identity status and exact
  versus non-exact match status, the identified source message, and the
  requested nearby turns. It never finds a substitute by text or similarity.
  Another conversation can be read only when the user named it in the current
  request. (Core §5; `SKILL.md`, `hooks/lib/agent.js`)

## 6. References to the agent (Core §8)

- Ticked notes are shown in the pane tray and in a line above the message
  box: **☐ Attach to next message**. The next message the person sends carries
  the selected note text as hidden model context marked “collaboration data,
  not instructions.” (P21, A1, A5; D6)
- If a ticked note has been deleted, its tick is cleared and the message is
  held with a request to send it again. Other attachment failures hold the
  message and keep the ticks; with no ticks, a Notes problem never blocks a
  message. After a successful send, the plugin tries a few times over about
  10 seconds to find that message in the transcript and mark it. If it cannot,
  no line is shown. Attached note text remains hidden from the conversation
  display. (P21, A5; D7)
- **Receipts:** a 📎 line is shown only for messages submitted while Claude is
  idle. A message queued during a reply (the host supplies `turnId`) still
  carries the ticked notes as hidden context, but gets no 📎 line because its
  transcript identity cannot be established without guessing. For an idle
  message the host does not report the stored message id either, so the
  receipt is bound to the only user message with the sent text that appears
  after the moment of sending. If an earlier message with identical text were
  written late, the line could sit under that message instead. The receipt is
  a display cue only: the notes always travel with the message that was sent.
  (D7, D11; `hooks/register.tsx`)

## 7. Agent operations and locality (Core §§2, 6)

- **Tools:** `notes-read {lane, session?}` reads a lane;
  `notes-write {lane, content}` creates a plain note only;
  `notes-edit {lane, itemKey, content, expectedVersion}` edits authored text;
  `notes-source-reentry {lane, itemKey, contextWindow?, before?, after?, session?, readOtherConversation?}`
  reads a quoted source; `notes-open-panel {}` opens the pane on request. (A2,
  A4; `hooks/register.tsx`)
- `session` selects only the note holder. Reading a source transcript other
  than the current conversation requires `readOtherConversation: true`, and
  only when the user asked to read that source. When unauthorized, the tool
  reports that explicit flag; naming the note holder does not authorize source
  transcript access. `contextWindow` defaults to an agent-chosen 0–30 turns on each side. When
  the user asks for more, `before` or `after` can request any number of turns;
  `hasEarlier` and `hasLater` report whether more context remains. Cross-
  conversation authorization is behavioral: the Skill and tool contract
  allow reads only for a conversation the user names. (Core §6; `SKILL.md`,
  `hooks/lib/agent.js`)
- There is no delete tool and no quoting tool. The user quotes in the pane.
  The user can search across lanes, sort, pin, and edit inline or in an
  editor; deleting is available only to the person, in the pane, after inline
  confirmation. Stale edit/delete conflicts show a banner with **Load latest**
  and **Overwrite anyway**. Overwrite reapplies the edit to the latest lane
  and never writes a stale body.
  After a successful agent write or edit, the pane redraws immediately; the
  agent reports the lane and does not ask the user to refresh. (D8;
  `SKILL.md`)
- **Other conversations:** tools read another conversation only when the
  user names it in the current request. Such access is read-only and grants
  no standing authority. (Core §6; `SKILL.md`)

## 8. Concurrency and integrity (Core §4)

- Supported pane and agent writes use SHA-256 compare-and-swap on the
  lane-file version, staging a temporary file and moving it into place. A
  per-lane queue serializes pane and agent-tool writes within the plugin
  process only; it is not a cross-process lock. The version check catches
  changes made before a write is checked. A write by another program in the
  instant between the check and the move is not coordinated and can be lost;
  only the plugin's own writers are coordinated in-process. Edits through the
  host file pane are checked against the file version before being applied.
  (P15–P16, I3; Core §4)
- A stale edit is not silently reported as an ordinary successful write.
  Missing roots and unavailable source are reported without recreating a
  root, changing source identity, or discarding the stored quote. (Core §§4–5;
  `hooks/lib/store.js`, `SKILL.md`)

## 9. Forks and carry (Core §7; Decision D10)

- Fork detection reads the transcript incrementally, consuming only appended
  content; if the file shrinks (a rewrite), reading restarts from the
  beginning. Parent entries keep the parent's session id. The pane asks once
  whether to carry **All**, **By lane**, or **None** only in a set-up project,
  when the parent has notes and the carry decision is undecided. A continued
  session with the same transcript shape is also asked. (H3–H5, D10)
- If a lane already has notes in the branch, the user chooses **Merge**
  (parent first), **Keep**, or **Replace**. Notes quoted from after the fork
  point stay behind; notes without a source, or with a source in neither
  history, are kept. Carried notes get new item keys and then evolve
  independently; capture origin and historical source remain attached to
  their original relationship. (D10; Core §7)
- Before writing each lane, the marker records planned keys so a retry never
  duplicates already written notes. The decision is recorded in the child
  marker at `<notes root>/.carry-over/<child session id>.json`. (D10)

## 10. Lifecycle and resilience

- **Entry:** in a project with Notes set up, session start opens the native
  pane. `/notes` opens it and runs setup in a new project; Claude can open it
  with `notes-open-panel` when asked. Closing with **×** hides it. A message
  sent at least five minutes later brings it back. In a project without Notes,
  a one-time hint says to type `/notes`; otherwise the plugin stays quiet.
  (P2, P11; I2)
- **Setup:** one binding per project folder. The default root is
  `<project>/notes`; the user can browse or type another path. If the chosen
  folder already contains recognized Notes lanes, setup reuses them. Missing
  roots are not silently recreated. (D4)
- **Language and help:** the pane header switches between 中文 and English
  and remembers the choice. First use follows the system language; the
  plugin cannot read the app's chosen UI language. **?** opens help. (P14,
  P22; D9)
- **Distribution:** product `Collaborative Notes for Claude Desktop`,
  plugin `collaborative-notes`, first public version `0.1.0`; the public
  repository is `aprilxuMLC/claude-collaborative-notes`, and its marketplace
  name is `collaborative-notes`.
  - Install: `claude plugin marketplace add aprilxuMLC/claude-collaborative-notes`
    then `claude plugin install collaborative-notes@collaborative-notes`,
    then restart Claude desktop.
  - Update: `claude plugin marketplace update collaborative-notes` and
    `claude plugin update collaborative-notes@collaborative-notes`, then
    restart Claude desktop.
  - Uninstall: `claude plugin uninstall collaborative-notes@collaborative-notes`.
    Notes remain in the project's notes folder.

## 11. Data access declarations

The plugin reads:

- the configured notes root and its own store under
  `~/.claude/plugins/store/`;
- the current conversation's transcript JSONL, plus the parent conversation's
  transcript during fork detection and carry; other source transcripts are
  read only when the user names that conversation;
- the clipboard only when **📋 Quote copied text** is pressed;
- folder listings while the user browses during setup;
- the system's preferred language at session start until the user chooses a
  language;
- app session metadata (`get_session`) only to offer **Open the original
  conversation**.

It writes the notes root and its own plugin store, including `.editing` and
`.carry-over` paths, and creates temporary editor files. It uses operating-
system commands for clipboard and language access, file moves/removal/folder
operations, opening links, and launching the editor. App session metadata is
read only to offer **Open the original conversation**. The plugin makes no
network requests; ticked notes reach the model only as part of the person's
own message. Notes are ordinary files in the chosen folder; bindings, ticks,
marks, and language preference are in the plugin store. (P6, D4, D9;
`hooks/register.tsx`)

## 12. Known qualifications

- Buttons that open or close the host file pane often need two clicks. (P18)
- After an app restart, the pane is drawn together with the conversation:
  usually within seconds, occasionally after tens of seconds. (P23)
- If `/notes` is sent as the very first message of a brand-new session, it
  may reach Claude before the plugin is ready. Claude then opens the pane
  itself, or the user can type `/notes` again. (I2; `SKILL.md`)
- Long or multi-paragraph note bodies use the app's file pane when the notes
  root is inside the session's project folder; otherwise they use the system
  text editor (macOS TextEdit via `open -t`, Windows Notepad). The file pane
  auto-saves and the note follows each save; the system editor's file is read
  back when saved. The pane's own text input is single-line.
  (P13, P15–P16; D3)
- Narrow windows have not been tested. The plugin pane has no smooth inner
  scrolling; **↑ Back to top** is provided instead. (P19; capability map,
  “Not yet verified”)
- CI unit tests and plugin validation passed on GitHub `windows-latest` and
  `macos-latest` on 2026-10-04, and Windows-specific path and clipboard code exists. This does
  not verify Claude desktop on Windows, which has not been tried. (capability
  map, “Not yet verified”)
- This profile depends on Claude Code plugin APIs and transcript behavior
  that may change. The observed desktop evidence is Claude desktop 2.19675.0
  with Claude Code engine 2.1.286 on macOS. (capability map)
