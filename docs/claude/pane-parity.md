# Parity with the DSH / Codex releases

> **Status:** checked before the first public release (release 0.1.0, 2026-10-04).
> Baseline: the Codex DSH parity table (`codex-work-collaborative-notes`
> `docs/codex/dsh-parity.md`, 83 items) and a feature-by-feature comparison
> with the Codex README, adapter specification and skill. Host facts:
> [capability-map.md](capability-map.md); decisions:
> [decisions.md](decisions.md). macOS, desktop Code tab.
>
> **Legend:** ✅ implemented · ◐ implemented differently or with a workaround
> (stated) · ✗ not possible on this host · ○ not verified.

## By area

| Codex items | Area | Status | How on Claude |
|---|---|---|---|
| 1 | Install, update, remove; notes kept on disk | ✅ | Plugin marketplace (P9); notes are plain files; store per install (P12) |
| 2–4 | UI language, zh/en parity | ◐ | Full zh/en strings; a 中文/English switch, first use follows the system language — the app's own UI language is not readable (D9, P22) |
| 5–14 | Setup gate, location chooser, binding, missing root | ✅ | Per project folder; default `<project>/notes`; folder browser (Up, hidden folders last, New folder) or typed path; no silent recreation |
| 15–19 | Lanes, display names, skill | ✅ | Four lanes; names confirmed at setup, global like Codex (laneConfig); skill `collab-notes` |
| 20–23 | Entry, header controls, reopen | ✅ | Opens by itself in set-up projects; `/notes`; agent `notes-open-panel`; reopens with a message ≥ 5 min after a manual close (as Codex) |
| 24–26 | Lane tabs, footer, help | ✅ | Help behind "?" |
| 27, 34, 40, 62 | Composer, body rules, edit, drafts | ◐ | Pane input is single-line (P13): long notes and multi-line edits go to the file pane beside the conversation, which auto-saves (D3, P15–P16) |
| 28–33 | Quote selection, preview, failure hints, one message only | ◐ | Pane text cannot be selected (P7b, P8e). Copy in the conversation → 📋 (located over the whole conversation; several places shown as search results), or 🔍 pick first and last sentence. S stays exact and verified (D2) |
| 35–37, 41–45 | Keys, versions, counts, sort, delete confirm, pin, search | ✅ | |
| 38, 47, 48 | Return to source, highlight, non-exact cue | ◐ | In the pane, quoted turn alone by default, earlier/later without limit; the native transcript cannot be scrolled by a plugin (Q4c), so the native message gets a temporary yellow frame instead |
| 49–51 | Return outcomes, other conversation with consent | ◐ | Read after a per-request confirmation; "Open the original conversation" only when the app confirms it knows that conversation (app and transcript ids often differ) |
| 52–58 | Ticks, tray, attach to the next message, receipt | ✅ | `prompt.submit` context; held back when attaching fails; a 📎 line under the message (D6, D7) — better than Codex |
| 59–61 | Versioned saves, conflict banner | ✅ | SHA-256 compare-and-swap, temp file + move |
| 63–68 | Fork detection and carry | ✅ | From the transcript (H3–H5); all / by lane / none; Merge / Keep / Replace; Codex marker format (D10) |
| 69–79 | Skill, agent tools, error codes, refresh prompt | ✅ / ◐ | In-process tools (A2, A4); no refresh prompt because the pane redraws (D8) |
| 80–83 | Rendering, limits, storage format | ✅ | Same dsh-note v1 format and locations (D4) |
| — | Windows | ○ | Code paths and CI (unit tests, validation on windows-latest) pass; the desktop app is not tried on Windows |

## Not possible on this host (✗)

None of the Core requirements. The experience differences above are the host's
limits: no selectable text in the pane, no programmatic scroll of the native
transcript, single-line pane input, no way to read the app's UI language.

## Removed compared with Codex

The local service, its port, token and cookie; the service hand-over on
upgrade; the history cache; the "Attaching…" after-the-fact confirmation; the
"please refresh" prompt.
