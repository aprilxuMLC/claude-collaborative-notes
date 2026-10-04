# Claude desktop Code tab — capability map

> Host evidence for Collaborative Notes. Product semantics live in the
> Concept / Core Contract / Agent Guide; this file records only what the host
> does.
>
> **Labels:**
> - **REAL** — observed in the desktop Code tab on the user's Mac.
> - **STATIC** — read-only inspection of the app bundle (minified,
>   version-specific, not an API).
> - **TYPES** — the engine's own API declaration, written by the
>   `plugin-authoring` skill for the running build. It is marked
>   "EARLY ACCESS: this surface may change between releases without notice."
> - **LOCAL DATA** — structure of local files (fields only, no content).
>
> **Observed versions:** Claude desktop 2.19675.0, Claude Code engine 2.1.286,
> macOS. Windows has not been examined.

## 1. Notes surface beside the conversation (the panel question)

| # | Fact | Label |
|---|---|---|
| P1 | A plugin of *function hooks* (a `hooks/hooks.json` naming a TypeScript module that exports `register(on, options)`) can open a **Pane** with `$.ui.open({ id, title })` and draw it from a `ui.render` hook on `{ component: 'Pane' }`. | TYPES |
| P2 | Opened unasked from `session.start`, the pane appeared **docked beside the transcript** in the desktop Code tab: `surface=desktop`, `placement=dock`, `isPlaced: true`, about 63 columns wide. No agent tool call and no user action were needed. The app's layout reports it as an open `plugin` pane. The user can close it (×) or expand it. | REAL |
| P3 | Desktop pane elements: `Box`, `Text`, `Button`, `Input`, `Select`, `Svg`, `Link`, `Code`, `Markdown`, `Client` (a sandboxed surface module with pointer and key input). There is no DOM, no HTML page and no Node in the module; everything goes through `$`. | TYPES |
| P4 | An `Input` and a `Button` in the pane worked; the value was written to `$.state` and persisted with `$.store`. | REAL |
| P5 | A pane redraws when the `$.state` values it read change; no polling is needed. | TYPES, REAL |
| P6 | `$.store` is a per-plugin JSON file under `~/.claude/plugins/store/` (4 MiB limit). `$.fs` reads and writes files, so Notes can live in a project folder instead. | TYPES, LOCAL DATA |
| P7 | Hot reload: a mod under the session's dev-mods folder reloads when a turn ends, after the user enables hot reloading once per session. `session.start` runs again on reload; at that moment `$.session.surfaces()` returned an empty list. | REAL |
| P7a | `$.state` values **survive a hot reload**; a module whose value shape changed must tolerate or migrate the old shape (an old-shape value broke the pane until filtered). | REAL |
| P7b | A `Client` element (surface module with pointer/key input) **does not load on the desktop**: "did not load within 10s (a content security policy …)". Custom in-pane interaction such as drag-selection is therefore unavailable there. | REAL |
| P8a | A plugin can call the built-in browser's MCP tools directly (`$.mcp.call("Claude_Browser", …)`, `$.tool.call({ tool: "mcp__Claude_Browser__…" })`) without a model turn. Read-only `tabs_context` always answers. | REAL |
| P8b | **Manual mode:** a plugin's `navigate` to `http://localhost:<port>/` succeeded with no prompt; the page loaded in the browser pane but the pane stayed **hidden** until the user pressed ⌘⇧B (as in anthropics/claude-code#88965). `preview_start` hung waiting for an approval that was never shown. Text selection in the page works and reached the plugin through a local server (118 chars, newlines kept). | REAL |
| P8c | **Auto mode:** every plugin-initiated `navigate` / `preview_start` is denied: the tool's own check answers `ask` ("Claude Browser requires permission"), and the server-side classifier then refuses because "the request that produced this action did not ask for one". This held at session start and on a button press, in a fresh session, and with `mcp__Claude_Browser__navigate` in the project's allow rules. | REAL |
| P8d | A plugin's own `tool.check` hook is **not consulted for that plugin's own calls**; a plugin cannot grant itself permission. | REAL |
| P8e | A pane `Link` to `http://localhost:…` opens in the **system** browser, not the built-in pane. Pane text cannot be selected or copied. | REAL |
| P8f | `pbpaste` from the plugin needs a UTF-8 locale in its env (`LANG` is unset; non-ASCII came back as `?`). | REAL |
| P8 | The built-in browser pane opens only through agent tools (`preview_start` / `navigate`). No `claude://` deep link opens a URL in a session's panel. | STATIC |

| P9 | A function-hooks plugin **installed from a (local) marketplace** at user scope loads in the desktop: a new session opened its pane unasked, loaded from `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`. No consent prompt was reported. | REAL |
| P10 | Installing a user-scope plugin **loads it at once into every running session**, including sessions of unrelated projects, which then open its pane. A real plugin must decide per session (for example: only where the project is set up) before opening anything. | REAL |
| P11 | **Lifecycle:** a session switch, a resume and an app restart each raise `session.start` (classic `SessionStart` `source=startup` or `resume`) and the plugin's `$.ui.open` places the pane again. `e.surface` and `$.session.surfaces()` are empty at that moment on the desktop. | REAL |
| P12 | `$.store` is keyed per install (`<plugin>_<marketplace or inline>-<hash>.json`); a dev-folder copy and an installed copy do not share it. | LOCAL DATA |
| P13 | A desktop pane `Input` is **single-line**: a pasted multi-paragraph text arrived with its newlines turned into spaces. | REAL |
| P14 | `LANG` is unset in the plugin environment; `Intl` reports `en-US`. The app's own UI language is still to be found. | REAL |
| P15 | A plugin can show and close the app's **file pane** beside the conversation: `$.mcp.call("ccd_view", "show_pane", { pane: "file", path })` and `close_pane`. Only files inside the session's folders open. A `.md` opens as a rendered preview (`</>` switches to source); a `.txt` opens as editable source. | REAL |
| P16 | The file pane **auto-saves** edits to disk (on by default, "Auto save is on"); there is no Save button. A plugin can follow the file and apply each save. | REAL |
| P17 | The app **restores file-pane tabs** when a session is reopened, including files since deleted ("Couldn't find this file"). | REAL |
| P18 | Clicks in the plugin pane: keeping the focus ring still (`ui.focus` answered without `next`) made ordinary buttons respond to one click; buttons whose action opens or closes another pane (file pane) still often need two clicks. | REAL |
| P19 | A pane has **one scroll region** (its body). A plugin can take over the body's scroll (`ui.scroll` answered without `next`) and window its own rows, but moves come in whole rows per wheel tick and feel jumpy; there is no smooth inner scroll area, so a pinned header with a smoothly scrolling list is not available. The pane can scroll itself to the start (`$.ui.scroll({ in, to: 'start' })`). | REAL |
| P20 | A pane render that throws, or gives an element a prop the host rejects (for example `plain={false}`: `plain` must be `true` or absent), draws **nothing** for the whole pane; reopening the pane does not help while the same state is kept. A plugin should catch render errors itself and offer a way back. | REAL |
| P22 | The app's UI language: a choice made in the app is kept as `locale` in the app's own store (beside sign-in data), otherwise it follows the system's preferred languages (`app.getPreferredSystemLanguages()`). The plugin API exposes neither; `Intl` in the module says `en-US`. | STATIC |
| P23 | Start-up timing after an app restart (this Mac, a 30 MB transcript): the module was ready in under 2 s (pane opened at 1.1 s, notes read at 1.2 s, transcript read at 1.7 s). The host then drew the pane **together with the conversation's first messages**: once 3.4 s after load, once not within 15 s (about 30 s by the user's watch). The wait is in the app's drawing of the session, not in the plugin. | REAL |
| P21 | `prompt.submit` lets a plugin add `context` blocks the model reads beside the prompt and the user never sees, or refuse the prompt with `{ drop: reason }` (the reason is shown). `$.tool.register` declares agent tools served by the plugin's own `tool.call` hook. | TYPES |

**Not yet verified:** behaviour on narrow windows; the CLI (TYPES say the
terminal places an unasked pane only from 144 columns); the app's UI
language setting; Windows desktop behavior. Windows CI has run; Windows
desktop behavior has not been examined, so the CI result is the only Windows
validation.

## 2. Capture from the conversation

| # | Fact | Label |
|---|---|---|
| Q1 | The desktop raises `ui.render` for every **AssistantMessage** text block. A hook can redraw that block (here: the same Markdown plus a 📝 button). | REAL |
| Q2 | Pressing the 📝 button ran the plugin's handler, stored a quote, and updated the pane. **No conversation turn was created.** | REAL |
| Q3 | The hook's `requestId` is `<API message id>-t<n>` (for example `msg_…-t0`). In the transcript JSONL every content block is its own entry with its own `uuid`, and the entries of one reply share `message.id`. A quote can therefore be mapped mechanically to `{sessionId, uuid}` of the text-block entry. | REAL, LOCAL DATA |
| Q4 | The hook receives the whole text block. The API declares no access to the user's text selection inside the transcript. A **sub-span** selection in the native transcript is therefore not available. | TYPES (absence) |
| Q5 | `UserMessage` rows also raise `ui.render`. | TYPES |
| Q6 | `$.session.id()` returns the transcript file's session id; `$.session.messages()` returns `{role, text, toolUses}` rows **without** uuids. Exact identity comes from the render `requestId` or from reading the JSONL. | REAL (id), TYPES |
| Q4a | The user's own selection reaches the plugin by **copy and paste**: select in the native transcript, ⌘C, then paste into a pane `Input`. The pasted text is the *rendered* text (Markdown markers gone, whitespace re-serialized), while the hook's `text` is the Markdown source. Verification therefore compares S with a visible-text projection of the source (markers removed, a map back to source positions, whitespace runs treated as one). A sentence crossing bold, code and a symbol verified with one match. | REAL |
| Q4b | A render hook can **highlight S in place** in the native transcript (all matches). The probe redrew the block as plain text with highlighted runs, losing the Markdown formatting; a formatting-preserving highlight is still to be found. | REAL |
| Q4c | `$.ui.scroll({ to: { requestId } })` from a pane button returns `deny: "transcript not scrollable here"` on the desktop. **The plugin cannot move the native transcript** to a source message; return-to-source navigation must happen inside the pane. | REAL |
| Q4d | The full transcript JSONL can be read past `$.fs.read`'s 4 MiB limit by streaming `$.process.spawn` output (local transcripts reach 78 MB). Search over text blocks yields `<message.id>-t<n>` render ids; a full scan of a 3 MB transcript (589 lines) took 24 ms in the pane. | REAL |
| Q7 | A malformed tree in a render hook makes the engine skip the hook and draw its own row; the transcript shows one dim line naming the plugin and the reason. | REAL |

## 3. Agent channel

| # | Fact | Label |
|---|---|---|
| A1 | `prompt.submit` sees and may rewrite the prompt before it is queued; `$.session.append` adds a user-role row the model reads (`isMeta`) or a notice it does not. Either could carry ticked notes to the agent. | TYPES |
| A2 | `$.tool.register` declares agent tools (`mcp__<plugin>__<name>`) served by a `tool.call` hook, so no separate MCP server process is required. | TYPES |
| A3 | Classic settings hooks (SessionStart, UserPromptSubmit + additionalContext) are also available. | LOCAL DATA (F1) |
| A4 | A tool answered from a plugin's `tool.call` hook must give `result` as **text** (or content blocks): an object result is refused ("does not match its output shape") and the model gets an error. The tools then appear to the model as `mcp__collaborative-notes__<name>` (deferred, loaded on demand). | REAL |
| A5 | `prompt.submit` context reached the model as a "prompt.submit hook additional context" block beside the user's message; the user saw only their own text. | REAL |

## 4. Identity, history, fork

| # | Fact | Label |
|---|---|---|
| H1 | Sessions are JSONL at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`; entries carry `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`. Originals survive compaction. | LOCAL DATA |
| H2 | Rewinds create branches inside the same file (a tree). | LOCAL DATA |
| H3 | Static reading suggested the desktop fork gives copied entries new uuids. **Observed instead** (engine 2.1.286): the fork's file copies the parent's entries **with their original `uuid`, `sessionId` (the parent's) and `message.id`**; the fork's own entries carry the new session id. Lineage and "is this source in the child's history" can therefore be read mechanically from the child's file. | REAL, LOCAL DATA |
| H4 | The hook sees a fork as classic `SessionStart` `source=resume` with the new session id; the `fork` value the types allow was not observed. Fork detection therefore reads the transcript (mixed session ids), not the hook. | REAL |
| H5 | A fork's (or a continued session's) transcript starts with the parent's entries under the parent's session id, then its own; with nested forks the ids run oldest first. The immediate parent is the last session id that is not the file's own. | LOCAL DATA |
| H6 | Desktop app session ids (`local_<uuid>`) equal the transcript session id for forks but often differ for sessions created in the app; no plugin-reachable API maps one id to the other. | REAL |
