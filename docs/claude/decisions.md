# Decisions — Collaborative Notes for Claude Desktop

> Product decisions are the user's; implementation decisions carry a short
> trail (what, why, assumption, why not Decision-Design, validation). Host
> facts are in [capability-map.md](capability-map.md).

## D1 — Notes surface: native plugin pane (option A) · user · 2026-10-03

The Notes surface is a function-hooks plugin pane docked beside the
transcript. Quoting uses the native transcript: select, ⌘C, "📋 Quote copied
text", located and verified against the transcript. A browser-page view (B)
or a system-browser view (C) may be added later.

- **Why:** the only option that works in every permission mode at install
  (P8c: plugin-opened browser pages are denied in Auto mode).
- **Evidence:** [pane-parity.md](pane-parity.md), P2, P8a–P8e, Q4a–Q4d.

## D2 — Quote invariant · user · 2026-10-03

A quote is `sessionId + messageId + S`, S being the user's exact selection.
If the place within the message is ambiguous on return, highlight every
match. Whole-block quotes do not meet the need.

## D3 — Long-note editing follows the available project editor · implementation · 2026-10-04

The pane `Input` is single-line (P13). When the notes root is inside the
session's project folder, long or multi-paragraph bodies use the app's file
pane, which auto-saves and is followed after each save. Otherwise the plugin
uses the system text editor (macOS TextEdit via `open -t`, Windows Notepad)
and reads the file back when it is saved. The version check is used before
applying each edit.

- **Why:** use the app's native editor when it can reach the notes root and
  preserve a working path for roots outside the project.
- **Assumption:** the host file-pane save notification is sufficient to
  follow each save.
- **Why not Decision-Design:** this is a reversible editor-path choice; it
  does not change note semantics, authority, or storage.
- **Validation:** code paths in `hooks/register.tsx`; host file-pane behavior
  observed in P15–P16.

## D4 — Storage: same as Codex · user · 2026-10-03

- One-time setup per project binds a notes root, default `<project>/notes`.
  A missing configured root is reported, never recreated.
- Layout `<root>/<lane>/<sessionId>.md` for `conversation_todo`,
  `deferred_work`, `knowledge_candidate`, `lesson_candidate`.
- Content: `dsh-note v1` blocks, with `dsh-meta host: claude`.
- Downstream agents read the same files as for the Codex and DSH releases.

## D5 — Acceptance by local-marketplace install · user · 2026-10-03

Each stage is tried by installing from this repository as a local
marketplace, in a new session, as a real user would.

## I1 — Source identity fields · implementation · 2026-10-03

- **What:** `source-payload: {"sessionId": <transcript session id>,
  "messageId": <transcript entry uuid of the quoted text block>}`.
- **Why:** the uuid is durable in the JSONL, survives compaction, and is kept
  in forks (H3); the render id `msg_…-tN` is derived from it on demand.
- **Assumption:** entry uuids stay stable across app versions.
- **Why not Decision-Design:** it realizes the user's `sessionId + messageId`
  invariant (D2) without adding a field.
- **Validation:** fork test (H3) and transcript reads (Q3).

## I2 — Silent in projects without Notes · implementation · 2026-10-03

- **What:** the pane opens by itself only in projects bound to a notes root.
  Elsewhere the plugin shows one hint per project ("type /notes to set up")
  and stays out of the way; `/notes` opens the pane with the setup gate.
- **Why:** a user-scope plugin runs in every session of every project (P10).
- **Why not Decision-Design:** it does not change capture, authority or
  storage; easy to revisit if the user wants the setup gate everywhere.

## I3 — Storage writes inside the plugin · implementation · 2026-10-03

- **What:** lanes are read and written by the hooks module through `$.fs`;
  the version token is SHA-256 of the lane file (`crypto.subtle`); writes go
  to a temporary file and are moved into place; one in-process queue per
  lane file serializes the pane and the agent tools.
- **Why:** the module has no Node; spawning Node is unreliable (Codex
  lesson). Only this session's process writes its own lane files, except
  out-of-band editors, which the version check catches.
- **Validation:** unit tests of the format and the writer; real-host check in
  stage 1 acceptance.

## D6 — Ticked notes shown above the prompt · user decision · 2026-10-04

- **What:** while notes are ticked, the band above the prompt says how many
  will go with the next message, with "Clear"; the pane keeps Codex's tray.
- **Why:** the user should not have to look at the pane to know what the next
  message carries.

## D7 — A mark under the message that carried notes · user decision · 2026-10-04

- **What:** after a message is sent with ticked notes, a small line under that
  message in the conversation says how many notes went with it and starts each
  one. The attached text itself stays invisible (model context only).
- **Why:** the user can see later what Claude was given; Codex could not show
  this.
- **Kept where:** the plugin's own store, per session (a UI cue, not part of
  the notes format).

## D8 — No refresh prompt after agent writes · user decision · 2026-10-04

- **What:** agent tools write through the pane's own writer and the pane
  redraws at once, so the agent's reply names the lane instead of asking the
  user to refresh (Codex's refresh prompt is dropped).
- **Why:** the prompt was a workaround for Codex's panel; here it would be
  untrue noise.

## D9 — Language switch in the pane · user decision · 2026-10-04

- **What:** a "中文 / English" switch in the pane header, remembered for the
  plugin. Before any choice the language follows the system's first
  preferred language (Claude Code's own `language` setting is not a UI
  language and is not used).
- **Why:** the plugin cannot read the app's chosen UI language: the app keeps
  it (`locale`) in the same store as sign-in data, which the plugin must not
  read (host fact P22).

## D10 — Fork carry as in Codex · user decision · 2026-10-04

- **What:** a fork's pane asks once whether to bring the parent's notes:
  All / Some (by lane, as Codex; Codex has no per-note choice) / None.
  Lanes the branch already used ask Merge (parent first) / Keep / Replace.
  Notes whose source lies after the fork point are skipped and counted.
  Carried notes get new keys; capture origin and source stay. The decision is
  kept in `<root>/.carry-over/<child session id>.json`, the Codex marker
  format (version 2; `parentThreadId` holds the parent session id).
- **Why:** parity with Codex; Core §7.

## D11 — Keep the 📎 receipt with a stated residual risk · user decision · 2026-10-04

- **What:** the receipt stays. Queued messages get none; an idle message's
  receipt binds to the only matching user message written after the moment
  of sending. The documented residual case (an earlier identical message
  written late) can misplace the line; the notes themselves always travel with
  the sent message.
- **Why:** the host gives no stored-message identity at submission; the
  independent review preferred omitting receipts, the user preferred keeping
  the cue with the limitation stated.
