# Collaborative Notes for Claude Desktop

**English** | [中文](README.zh-CN.md)

**Keep the conversation moving. Keep the important things from getting lost.**

Collaborative Notes sits beside your conversation in the **Code tab of the Claude desktop app**. Capture ideas, questions, decisions and loose ends without pulling the active conversation off course. Then return to them when they matter, right back to the passage they came from.

> **A shared attention workspace for human–agent collaboration: something can leave the main thread without leaving the collaboration.**

Collaborative Notes is a human–agent collaboration plugin. It is not a general notebook, a task manager, a long-term memory, or a knowledge base. It adds a **shared transient workspace** beside the current conversation. It helps you and the agent decide what should keep occupying attention now, what can safely be set aside, and how to bring it back accurately when it matters again.

**First public version: 0.1.0.** The plugin is named `collaborative-notes`; the marketplace is named `collaborative-notes`. The supported host claim is the Claude desktop app's Code tab on macOS. Windows code paths and CI checks exist, but the desktop app has not been tried on Windows.

It continues the [Collaborative Notes for DeepSeek Harness](https://github.com/aprilxuMLC/dsh-collaborative-notes) release and shares its product contract. The Claude desktop realization is described in the [Claude desktop adapter specification](docs/claude-desktop-adapter.md) ([简体中文](docs/claude-desktop-adapter.zh-CN.md)).

---

# I. What it is, and why it matters

### Conversation is linear. Work is not.

Real work constantly produces side paths. Keep everything in the conversation and the main thread gets heavier. Drop everything into a separate notebook and it is easy to lose why something mattered in the first place.

Collaborative Notes explores a third option:

> **Let something leave the main thread without leaving the collaboration.**

That is not only a memory problem. It is also an attention problem.

### Attention Dilution

In long-running collaboration, all the history, files, memory and notes may still exist, yet the agent faces another problem. As more and more items stay "potentially relevant", it gets harder to decide what deserves attention now. Nothing is lost, but the collaboration becomes less clear: the constraints that matter most are diluted by everything that might matter.

Collaborative Notes explores whether **attention itself can be a resource that humans and agents manage together**. What is needed now stays in the main thread. Other material, once reliably placed, can leave the agent's continuous attention, and the user or the current task can bring it forward again later.

This uses a simple human–agent asymmetry. A human does not need to keep every item inside an active context. A visible shared surface supports low-cost peripheral attention: glance at an item, pin it, tick it, or say "bring this one back". The agent then re-reads and reconstructs context through an explicit entry point when needed.

> **Human peripheral attention + agent on-demand reactivation.**

Whether this reliably reduces cognitive load or improves task quality is a product hypothesis that still needs validating across users and long tasks.

### Memory ≠ Attention

"Can this still be found later?" and "should this stay in attention now?" are different questions. Collaborative Notes lets reliably placed material stop demanding continuous attention. Deferred work, knowledge candidates and lesson candidates leave the main thread instead of following the conversation forever.

> **Can be retrieved ≠ must stay in attention.**

Setting something aside safely is only half the problem; the other half is returning to it. For notes that come from specific conversational material, Collaborative Notes keeps the relationship to the original discussion. Later work returns to the actual source instead of rediscovering a likely-looking place through full-text search or model inference.

> **Attention can be released without losing the return path.**

The current agent does not have to predict every future context need at capture time. A later agent or workflow with read authority can read the note, follow its preserved source back to the original discussion, and read as much surrounding context as its own task requires.

> **Future Context Handle, not Future Context Package.**

That is why the core stays small: capture, staging, routing, provenance and reactivation. Downstream consumers do the real processing:

| Note | Future consumer | Downstream work |
|---|---|---|
| **L1 Conversation to-do** | you and the agent, in this conversation (and its branches) | bringing it back when it is due, settling it, then closing it |
| **L2 Deferred work** | backlog / work-planning agent | sorting, merging, scheduling, execution |
| **L3 Knowledge candidate** | knowledge agent / workflow | verification, deduplication, restructuring, formalization |
| **L4 Lesson candidate** | retrospective / agent-improvement workflow | review, validation, acceptance, then possible Rule / Skill / Prompt / Workflow changes |

> **Candidate ≠ formal state.** Capturing something means it is worth processing later, not that processing has happened.

The default is **user-led capture with collaborative maintenance**.

- The agent may help write a note you decided to keep, or propose one, but a proposal is not a capture.
- It does not mine ordinary conversation for notes, and it does not deduplicate or merge items at capture time.
- Notes are **local by default**: other conversations' notes enter the current agent's work only when you name that conversation for the request.

> **Local by default, explicitly retrieved when needed.**

---

# II. What it can do

## Capability overview

- **A native pane beside the conversation.** The host's plugin pane docks beside the current conversation. In a project that has Notes set up, it opens by itself; `/notes` opens it and runs setup in a new project. You can also ask Claude to open it.
- **Four lanes, by destination.** L1 conversation to-do · L2 deferred work · L3 knowledge candidate · L4 lesson candidate. A lane says where a thought should go, not how urgent it is. Lane display names are chosen during setup, apply across projects, and never change the lane keys or files.
- **The basics.** Search all four lanes, sort, pin, edit, and delete with confirmation. Only you can delete.
- **Exact sources, faithful return.** A quoted note keeps your thought, the exact selected text, and the message it came from distinct. **↪ Return to source** shows the quoted turn by default with all exact matches highlighted; earlier and later turns can be opened as needed. The status says exact, not exact, or unavailable. The native message also gets a temporary yellow frame. Sources are never guessed or rebound to similar text.
- **Quote text despite the pane's selection limit.** The native pane text cannot be selected. Copy text in the conversation and click **📋 Quote copied text**, or use **🔍 Find in conversation** to search the whole conversation, including compacted parts, and pick the first and last sentence of a turn. Quoting creates no conversation turn.
- **An agent that knows how to work with your notes.** The plugin includes the `collab-notes` skill and in-process agent tools to read, write and edit plain notes, return to a quoted source, and open the pane. The agent never deletes notes or creates quotes. It works with this conversation's notes and, read-only, with another conversation only when you name it. After a write or edit, the pane redraws at once; no refresh is needed.
- **You decide what comes back, and when.** Tick **☐ Attach to next message** on a note's card; the pane tray and a line above the message box show how many will go and let you remove them. The next message you send carries them to Claude as hidden collaboration context, marked as collaboration data rather than instructions. After a successful send, the plugin tries to find the message in the transcript and show a 📎 receipt; if it cannot find it, no line is shown. If a ticked note was deleted, it is unticked and the message is held with a request to send it again. Other attachment failures hold the message and keep ticks; with no ticks, a Notes problem does not block a message.
- **Branches without losing your place.** A fork's pane asks once whether to carry all notes, notes by lane, or none. For lanes already used, you can Merge (parent first), Keep, or Replace. Notes quoted after the fork point stay behind; carried notes get new keys, and the two sides then evolve independently. A new session that continues an old one (its record starts with the old conversation) also asks once.
- **Plain files for downstream work.** Notes use the shared `dsh-note v1` Markdown block format, so agents and workflows can read them directly. The format and source fields are described in Section IV.
- **A language switch and help.** Switch between 中文 and English in the pane header; the choice is remembered. First use follows the system language. The app's own UI language cannot be read. Click **?** for help.

## What it looks like in use

**Jot something down without interrupting the conversation.** Write a note in the pane and choose a lane. Nothing is added to the conversation.

**Quote a passage you selected.** Select text in the conversation and press ⌘C, then click **📋 Quote copied text** above the message box or in the pane. The plugin looks across the whole conversation. If the text belongs to one message, it is attached to that message. If it appears in several, they are shown like search results; open one and choose **Quote it from this message**. If it is the same text you quoted last time, the pane asks whether you want to quote again. The clipboard is never cleared. Matching tolerates curly quotes and visible `**` markers. If nothing matches, a banner suggests trying a shorter plain-text part or using 🔍.

**Find and quote an older passage.** Click **🔍 Find in conversation**. Browse the latest 10 turns with summaries, load 20 earlier turns at a time, or search the whole conversation, including compacted parts. Open a turn, tap its first and last sentence, then choose **Quote selected text**. This only creates a note; it does not add a conversation turn.

**Bring back what the conversation has forgotten.** After a long conversation is compacted, Claude may no longer have early details in context, but your note keeps the original words and where they came from. Tick it so your next message carries it as collaboration context, or ask Claude to go back to the note's source and reread the original discussion. You can also click **↪ Return to source** in the pane.

**Keep key constraints within reach.** Rules in `CLAUDE.md` or `AGENTS.md` can fade from attention over a long conversation. Note the few constraints that matter and pin them. When the work comes near one, tick it: your next message puts it back in front of Claude, and **📎** shows it went.

**Bring selected notes into the next message.** Tick a note on its card; the pane and the line above the message box show how many will go. The next message carries those notes as hidden collaboration context. After the send, the plugin tries a few times over about 10 seconds to find the message in the transcript and add a **📎 n note(s) attached: …** line. If it cannot find the message, no line appears.

**Return to the source.** From a note, open the source to see the quoted turn, the quote is highlighted only when it matches exactly, and otherwise the whole message appears without a highlight. If the source is unavailable, the saved quote stays shown. Expand earlier or later turns as far as needed. The plugin cannot scroll the host's native transcript, so the matching native message receives a temporary yellow frame. To open a source in another conversation, the plugin asks first; it offers **↗ Open the original conversation** only when the app confirms it knows that conversation.

**Ask Claude to work with notes.** Try “Put this in L2: revisit caching after release,” “Add to that L1 note that the tests passed,” or “What do my L3 notes say?” Ask about another conversation by naming it, for example, “In my API design conversation, read the L3 notes about caching.” That access is read-only; opening its source requires confirmation. The pane redraws immediately after a successful write or edit.

**Start a branch with the right context.** In a fork, choose all notes, notes by lane, or none. Resolve lanes already present by merging with the parent first, keeping the branch's copy, or replacing it. Notes sourced after the fork point remain with the parent.

**Prepare downstream knowledge.** A separate agent or workflow can gather L3 notes about a topic with their source discussions and draft knowledge-base entries for your review. L2 notes can feed later planning; L4 notes can feed lessons after review.

---

# III. Install, first use and support boundary

## Install

Requires the Claude desktop app and the `claude` command in a terminal (Claude Code command line). In a terminal, run:

```sh
claude plugin marketplace add aprilxuMLC/claude-collaborative-notes
claude plugin install collaborative-notes@collaborative-notes
```

Then restart the Claude desktop app.

**Update:**

```sh
claude plugin marketplace update collaborative-notes
claude plugin update collaborative-notes@collaborative-notes
```

Restart the app after updating.

**Uninstall:**

```sh
claude plugin uninstall collaborative-notes@collaborative-notes
```

Your notes stay on disk as plain files in the project's notes folder. Bindings, ticks, marks and language preference live in the plugin store under `~/.claude/plugins/store/`.

## First use

1. Open a project in the Claude desktop app's **Code** tab. If Notes is set up for that project, the pane opens beside the conversation. In a project without Notes, a one-time hint says to type `/notes`; otherwise the plugin stays quiet. Send `/notes` to open the pane and start setup. You can also ask Claude to open the pane.
2. Set up Notes for that project's folder. The default notes root is `<project>/notes`. Choose another folder with the system folder dialog (Finder on macOS; it can also make a new folder) or by typing a path. If the chosen folder already contains Notes lanes, setup reuses them; if you pick the folder one level above (the one that holds `notes`), setup offers that `notes` folder. Later, **⚙ Change location** at the top of the pane opens setup again. The plugin does not silently recreate a missing notes root.
3. Choose the four lane display names when asked; these names apply across projects. Switch between 中文 and English from the pane header at any time. The first use follows the system language.
4. Write a note, quote a passage, tick a note for your next message, or ask Claude to read or edit a note. Use **?** in the header for help.

If you close the pane with ×, it comes back when you send a message at least five minutes later. `/notes` or asking Claude to open Notes also opens it.

## Support boundary

**Verified:** macOS, in the Claude desktop app's Code tab.

**Not claimed as supported:** Claude desktop Chat or Cowork modes, claude.ai in a browser, mobile, or Claude Code CLI and IDE extensions as user-facing hosts. Some tools may work in the CLI, but the pane may not appear there.

**Windows:** Windows code paths exist, including PowerShell handling for clipboard, files, links and editor operations, plus drive-letter paths. CI unit tests and plugin validation passed on GitHub's `windows-latest` and `macos-latest` on 2026-10-04. This does not verify the Claude desktop app on Windows, which has **not** been tried.

**Known qualifications:**

- Buttons that open or close the host's file pane often need two clicks.
- After an app restart, the pane is drawn together with the conversation. This usually takes seconds and can occasionally take tens of seconds.
- If `/notes` is the very first message in a brand-new session, Claude may receive it before the plugin is ready. Claude may open the pane itself; otherwise type `/notes` again.
- Pane text fields are single-line. Long notes use the app's file pane when the notes root is inside the session's project folder; otherwise they use the system text editor (macOS TextEdit via `open -t`, Windows Notepad). The file pane auto-saves and the note follows each save; text-editor changes are read back when the file is saved.
- Quoting covers text in one user or assistant message at a time, not reasoning, tool calls, tool output, or file changes.
- Deletion is permanent and has no recycle bin. Notes are ordinary, unencrypted Markdown files; they sync only if the chosen folder does. Editing lane files outside the plugin (including in another editor or the shell) can cause a version conflict.
- Narrow windows have not been tested.
- Smooth inner scrolling is unavailable; use **↑ Back to top** instead.

**Different from the Codex version:**

- Notes is the host's native plugin pane, not a browser page.
- Quoting uses copy-first matching or sentence picking because pane text cannot be selected.
- Return to source happens in the pane; the native transcript cannot be scrolled by the plugin.
- Ticked notes are hidden context on the next message; afterward, the plugin tries to add a 📎 receipt beneath that message. A message queued while Claude is replying gets no 📎 line. In a rare case (an earlier identical message written late) the line could sit under the wrong one; the notes themselves always go with the message you sent.
- The pane redraws after a write or edit, so no refresh is needed.
- A 中文/English switch is in the pane header, and `/notes` opens the pane and starts setup.
- Long notes use the app's file pane inside the project folder, otherwise the system text editor; changes are read back on save.
- A closed pane reopens with a message sent at least five minutes later, as in the Codex version.

## What the plugin reads

The plugin reads the notes root and its own store, the current conversation's transcript JSONL, and the parent conversation's transcript during fork detection and carry. Other source transcripts are read only when you name that conversation. It reads the clipboard only when you press **📋 Quote copied text**, lists folders during setup, and checks the system's preferred language at session start until you choose a language. It also creates and reads temporary editor files and `.editing` and `.carry-over` paths under the notes root, and uses operating-system commands for clipboard and language access, file moves/removal/folders, opening links, and launching the editor. App session metadata (`get_session`) is read only to offer **↗ Open the original conversation**. The plugin itself makes no network requests; ticked notes reach the model only as part of your own message.

---

# IV. For downstream agents and workflows

Notes are plain Markdown files, one file per lane and conversation:

```text
<notes root>/<lane>/<sessionId>.md
```

Each file contains `dsh-note v1` blocks with item keys. The metadata includes `dsh-meta host: claude`; source-aware notes store a payload of `{ "sessionId": "…", "messageId": "…" }`, where `messageId` is the transcript entry UUID, alongside the exact source text and the authored note. The source-independent and source-aware forms follow the shared DSH / Codex format.

Lane display names are asked for during setup. They apply across projects; overrides are saved in the plugin store as `laneConfig`. The lanes themselves remain the four destinations: L1 conversation to-do, L2 deferred work, L3 knowledge candidate and L4 lesson candidate.

A lane file's version token is its SHA-256 hash. Writes use compare-and-swap and a temporary file followed by a move. This lets a consumer detect stale versions rather than silently replacing concurrent edits.

When you ask for downstream work, a separate workflow might gather L3 knowledge candidates with their source discussions and draft entries for your review. L2 can feed planning, and L4 can feed a lessons review; those files remain candidates until reviewed.

Fork carry-over state is recorded at:

```text
<notes root>/.carry-over/<child>.json
```

The marker uses the Codex format version 2. Carried notes receive new item keys. A downstream consumer can read the Markdown files and follow a quoted note's `{sessionId, messageId}` back to the transcript entry, then read as much surrounding context as its task requires. L3 and L4 remain candidates until a person reviews and accepts the downstream result.

The agent tools are `notes-read {lane, session?}`, `notes-write {lane, content}`, `notes-edit {lane, itemKey, content, expectedVersion}`, `notes-source-reentry {lane, itemKey, contextWindow?, before?, after?, session?}`, and `notes-open-panel {}`. Writes create plain notes; edits use an item key and expected version. There is no delete tool and no quoting tool. Other conversations can be read only when the user names one. The `collab-notes` skill describes how agents are expected to use these tools.

---

# V. Design documents and development

| Document | Read it when you want to… |
|---|---|
| [Concept](docs/concept.zh-CN.md) *(简体中文)* | understand attention, staging, provenance and downstream work |
| [Core Contract](docs/core-contract.md) *(English)* | understand stable product semantics across hosts |
| [Agent Guide](docs/agent-guide.zh-CN.md) *(简体中文)* | understand how agents should work with notes and what they must not do |
| [Claude desktop adapter specification](docs/claude-desktop-adapter.md) ([简体中文](docs/claude-desktop-adapter.zh-CN.md)) | understand how the Claude Code tab realizes the contract and where host limits apply |
| [Claude capability map](docs/claude/capability-map.md), [decisions](docs/claude/decisions.md), [parity checklist](docs/claude/pane-parity.md) *(English)* | inspect observed host behavior, implementation decisions and the feature comparison |
| [Changelog](CHANGELOG.md) | see what changed |

The Concept, Core Contract and Agent Guide define the product. The adapter and Claude evidence documents describe the host-specific implementation and findings.

**Development:** the plugin uses one function-hooks module. There is no separate service process, MCP server process or browser page. The pane is rendered with the host's native plugin UI. Windows-specific code paths have unit-test and plugin-validation coverage on GitHub's `windows-latest`; this does not verify the desktop app on Windows.

## License

MIT. Files derived from DSH and Codex retain their respective notices.
