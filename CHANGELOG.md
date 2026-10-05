# Changelog

## 0.1.2

- ⚙ Change location moved to the top of the pane, beside Search and Refresh.
- Choosing another notes folder opens the system folder dialog (Finder on
  macOS, the standard dialog on Windows) instead of the in-pane browser.
- The long-note editor asks the app's file pane twice before falling back to
  the text editor, and says why when it does.

## 0.1.1

- Setup notices when the chosen folder is one level too high: if it holds no
  notes but its `notes` folder does, it offers to use that folder.
- "Change location" beside the bound path at the bottom of the pane opens
  setup again (with Cancel to go back). Notes stay where they are; choose the
  folder that holds them.

## 0.1.0

First public release of Collaborative Notes for the Claude desktop app
(Code tab, macOS).

- Notes pane beside the conversation, four lanes, setup per project folder
  (browse or type a location; lane names confirmed at setup, global).
- Quoting by copying from the conversation (📋) or picking sentences in
  🔍 Find in conversation; exact source identity (session + message + S).
- Return to source in the pane, with the quoted turn highlighted and any
  number of earlier and later turns.
- Ticked notes go with your next message; a 📎 line marks that message.
- Agent tools and a skill: read, write plain notes, edit, return to source,
  open the pane. No delete tool.
- Branches: bring the parent's notes (all / by lane / none).
- 中文 / English, help, `/notes`.
- Windows: code paths and CI only; the desktop app is not yet tried on
  Windows.
