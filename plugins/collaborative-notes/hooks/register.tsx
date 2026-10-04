import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { NotesCandidate, NotesCard, NotesCarry, NotesConflict, NotesEditing, NotesMark, NotesMirror, NotesQuote, NotesReentry, NotesView } from '../types'
import { carryMarker, forkParent, laneAlreadyHandled, planLane, resetCarryLane } from './lib/carry.js'
import { canBindReceipt, excerpt, foreignSourceNeedsReload, isSessionId, noteView, reentryResult, referenceText, resolveLane, sourceReadAllowed, uniqueUserMessageAfter } from './lib/agent.js'
import { detectLocale, strings } from './lib/i18n.js'
import { defaultLabels, LANE_KEYS, resolveLanes, sanitizeLaneConfig } from './lib/lanes.js'
import { findQuote, highlightRuns, parseLines, pasteHits, searchTurns, sentenceRange, sentences, toTurns, turnSummary } from './lib/transcript.js'
import { locate } from './lib/visible.js'
import {
  childFolder, clipboard, isRootPath, makeDir, makeDirs, moveFile, normalizePath, openInEditor,
  openLink as openLinkCommand, parentFolder, readAll, readFrom, removeFile, systemLanguage,
  tempFile, trimFolderPath,
} from './lib/platform.js'
import { assertEditorPath, editorBody, editorBodyFromHeaders, editorCanFinish, editorCommittedState, editorFile, editorMissingFinish, editorObservedState, editorPath, editorSyncCanWrite, editorWriteArgs, readCards, savedNewEditorCleanup } from './lib/notes.js'
import {
  addPlainNote, createRoot, deleteNote, editNote, getBinding, inspectRoot, lanePath,
  proposedRoot, readLane, resolveLocation, setBinding, takeHint, writeLane,
  rootExists,
} from './lib/store.js'

const PANE = 'notes'
const view = atom({ plugin: 'collaborative-notes', key: 'view' } as const, null as NotesView | null)
const lane = atom({ plugin: 'collaborative-notes', key: 'lane' } as const, 'conversation_todo')
const sort = atom({ plugin: 'collaborative-notes', key: 'sort' } as const, 'newest')
const cards = atom({ plugin: 'collaborative-notes', key: 'cards' } as const, {} as Record<string, NotesCard[]>)
const toast = atom({ plugin: 'collaborative-notes', key: 'toast' } as const, null as { text: string; error: boolean; at: number } | null)
const composer = atom({ plugin: 'collaborative-notes', key: 'composer' } as const, 0)
const versions = atom({ plugin: 'collaborative-notes', key: 'versions' } as const, {} as Record<string, string>)
const pins = atom({ plugin: 'collaborative-notes', key: 'pins' } as const, [] as string[])
const editing = atom({ plugin: 'collaborative-notes', key: 'editing' } as const, null as NotesEditing | null)
const confirm = atom({ plugin: 'collaborative-notes', key: 'confirm' } as const, '')
const search = atom({ plugin: 'collaborative-notes', key: 'search' } as const, null as string | null)
const conflict = atom({ plugin: 'collaborative-notes', key: 'conflict' } as const, null as NotesConflict | null)
const quote = atom({ plugin: 'collaborative-notes', key: 'quote' } as const, null as NotesQuote | null)
const candidates = atom({ plugin: 'collaborative-notes', key: 'candidates' } as const, null as { snapshot: string; list: NotesCandidate[] } | null)
const mirror = atom({ plugin: 'collaborative-notes', key: 'mirror' } as const, null as NotesMirror | null)
const reentry = atom({ plugin: 'collaborative-notes', key: 'reentry' } as const, null as NotesReentry | null)
const spotlight = atom({ plugin: 'collaborative-notes', key: 'spotlight' } as const, null as { renderId: string; snapshot: string } | null)
const tick = atom({ plugin: 'collaborative-notes', key: 'tick' } as const, 0)
const openSources = atom({ plugin: 'collaborative-notes', key: 'openSources' } as const, [] as string[])
const transcriptPath = atom({ plugin: 'collaborative-notes', key: 'transcriptPath' } as const, '')
let windowsPromise: Promise<boolean> | null = null
const isWindows = ($: any) => windowsPromise ??= $.env.get('OS').then((value: string | undefined) => value === 'Windows_NT')
const runPlatform = async ($: any, operation: (windows: boolean) => { argv: string[]; env?: Record<string, string> }) => {
  const command = operation(await isWindows($))
  return $.process.run(command.argv, command.env ? { env: command.env } : undefined)
}
// Notes ticked to go with the next message (`<lane>:<key>`), and the marks
// under messages that carried notes (by message uuid).
const ticks = atom({ plugin: 'collaborative-notes', key: 'ticks' } as const, [] as string[])
const marks = atom({ plugin: 'collaborative-notes', key: 'marks' } as const, {} as Record<string, NotesMark>)

// The pane's language: the person's choice (D9), else the system's first
// preferred language. Strings and lane names follow it; `lang` redraws.
let t = strings(detectLocale())
let language = detectLocale()
let laneConfig: any = {}
let lanes = resolveLanes(laneConfig, language)
const lang = atom({ plugin: 'collaborative-notes', key: 'lang' } as const, '')
const useLanguage = async ($: any, code: string) => {
  language = code
  laneConfig = (await $.store.get('laneConfig')) ?? {}
  t = strings(code)
  lanes = resolveLanes(laneConfig, code)
  await update($, lang, () => code)
}
const initLanguage = async ($: any) => {
  let code = (await $.store.get('locale')) as string | undefined
  if (code !== 'zh' && code !== 'en') {
    code = 'en'
    try {
      const r = await runPlatform($, systemLanguage)
      const first = /"?([A-Za-z-]+)"?/.exec(String(r.stdout).replace(/[()\s,]/g, ' ').trim())
      if (r.exitCode === 0 && first && first[1].toLowerCase().startsWith('zh')) code = 'zh'
    } catch { /* not macOS: keep English */ }
  }
  await useLanguage($, code)
}
// A clipboard text that was already quoted once, waiting for "quote again?".
const reuse = atom({ plugin: 'collaborative-notes', key: 'reuse' } as const, null as string | null)
const help = atom({ plugin: 'collaborative-notes', key: 'help' } as const, false)
const carry = atom({ plugin: 'collaborative-notes', key: 'carry' } as const, null as NotesCarry | null)
const laneLabel = (key: string) => lanes.find((l: any) => l.key === key)?.label ?? key

// Host operations for lib/store.js, built here so `$` stays in this file.
const io = ($: any) => ({
  exists: (path: string) => $.fs.exists(path),
  stat: (path: string) => $.fs.stat(path),
  list: (path: string) => $.fs.list(path),
  read: (path: string) => $.fs.read(path),
  write: (path: string, text: string) => $.fs.write(path, text),
  makeDirs: (path: string) => runPlatform($, windows => makeDirs(path, windows)),
  moveFile: (from: string, to: string) => runPlatform($, windows => moveFile(from, to, windows)),
  removeFile: (path: string) => runPlatform($, windows => removeFile(path, windows)),
  storeGet: (key: string) => $.store.get(key),
  storeSet: (key: string, value: unknown) => $.store.set(key, value),
})

const say = async ($: any, text: string, error = false) => {
  const at = Date.now()
  await update($, toast, () => ({ text, error, at }))
  // A notice goes after 3 s, an error after 10 s (or when the next action
  // succeeds), so a stale error never outlives what it was about.
  void $.clock.after(error ? 10000 : 3000, () => update($, toast, cur => (cur?.at === at ? null : cur)))
}

const failureText = (code: string, v: NotesView, detail?: string) =>
  code === 'ROOT_MISSING' ? t('rootMissing', { path: v.root })
    : code === 'STALE' ? t('stale')
      : code === 'EMPTY_CONTENT' ? t('emptyContent')
        : code === 'ITEM_UNRESOLVED' ? t('gone')
          : t('writeFailed', { detail: detail ?? code })

// Reload every lane; returns whether anything changed on disk.
const loadCards = async ($: any, v: NotesView) => {
  if (!v.root) return false
  const nextCards: Record<string, NotesCard[]> = {}
  const nextVersions: Record<string, string> = {}
  const read4 = await Promise.all(LANE_KEYS.map((key: string) => readLane(io($), lanePath(v.root as string, key, v.sessionId))))
  LANE_KEYS.forEach((key: string, i: number) => {
    nextCards[key] = readCards(read4[i].text) as NotesCard[]
    nextVersions[key] = read4[i].version
  })
  const before = await read($, versions)
  const changed = LANE_KEYS.some((key: string) => before[key] !== nextVersions[key])
  if (changed) {
    await update($, cards, () => nextCards)
    await update($, versions, () => nextVersions)
    const held = await read($, ticks)
    const kept = held.filter(id => { const [l, k] = splitTick(id); return (nextCards[l] ?? []).some(c => c.key === k) })
    if (kept.length !== held.length) await setTicks($, v, () => kept)
  }
  return changed
}

const pinKey = (v: NotesView) => `pins:${v.sessionId}`
const ticksKey = (v: NotesView) => `ticks:${v.sessionId}`
const marksKey = (v: NotesView) => `marks:${v.sessionId}`
const tickId = (laneKey: string, key: string) => `${laneKey}:${key}`
const splitTick = (id: string) => { const at = id.indexOf(':'); return [id.slice(0, at), id.slice(at + 1)] }
const setTicks = async ($: any, v: NotesView, change: (cur: string[]) => string[]) => {
  await update($, ticks, change)
  await $.store.set(ticksKey(v), await read($, ticks))
}

const currentView = async ($: any): Promise<NotesView> => {
  const project = normalizePath(await $.session.root())
  const sessionId = await $.session.id()
  const binding = await getBinding(io($), project)
  return { project, sessionId, root: binding?.root ?? null, setup: null }
}

const showBound = async ($: any, v: NotesView) => {
  await update($, view, () => v)
  const saved = ((await $.store.get(pinKey(v))) ?? []) as string[]
  await update($, pins, () => saved)
  const held = ((await $.store.get(ticksKey(v))) ?? []) as string[]
  await update($, ticks, () => held)
  const marked = ((await $.store.get(marksKey(v))) ?? {}) as Record<string, NotesMark>
  await update($, marks, () => marked)
  await loadCards($, v)
}

const startSetup = async ($: any, v: NotesView, candidate: string, other = false) => {
  const info = await inspectRoot(io($), candidate)
  const current = await read($, view)
  await update($, view, () => ({
    ...v,
    setup: {
      candidate, exists: info.exists, notDir: Boolean(info.notDir), lanes: info.lanes, other, error: '',
      nested: info.nested ?? '', previous: current?.setup?.previous ?? '',
      browsePath: current?.setup?.browsePath ?? v.project,
      folders: current?.setup?.folders ?? [],
      laneNames: current?.setup?.laneNames ?? lanes.map((entry: any) => entry.descriptive),
    },
  }))
}

const browseTo = async ($: any, path: string) => {
  path = normalizePath(path)
  try {
    const entries = await $.fs.list(path)
    const folders = entries
      .filter((entry: any) => entry.kind === 'dir')
      .map((entry: any) => entry.name)
      // Hidden folders (".local") come last, so they can still be chosen.
      .sort((a: string, b: string) => Number(a.startsWith('.')) - Number(b.startsWith('.')) || a.localeCompare(b))
    await update($, view, (cur: NotesView | null) => cur?.setup ? {
      ...cur, setup: { ...cur.setup, browsePath: path, folders },
    } : cur)
  } catch {
    await say($, t('browseFailed'), true)
  }
}

const validFolderName = (value: string) => {
  const name = value.trim()
  return name.length > 0 && name.length <= 100 && name !== '.' && name !== '..'
    && !name.includes('/') && !name.includes('\\') && !/[\u0000-\u001f\u007f]/.test(name)
}

const openPane = async ($: any) => {
  const v = await currentView($)
  if (v.root) await showBound($, v)
  else await startSetup($, v, proposedRoot(v.project))
  return $.ui.open({ id: PANE, title: t('title') })
}

const inApp = (path: string) => path.includes('/.editing/')
const editPrefix = (v: NotesView) => `${v.sessionId.slice(0, 8)}-`

// Remove this session's leftover edit files (from a crash or an app restart).
const cleanEditing = async ($: any, v: NotesView) => {
  const dir = `${v.root}/.editing`
  if (!(await $.fs.exists(dir))) return
  const ed = await read($, editing)
  let removed = 0
  for (const entry of await $.fs.list(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.name.startsWith(editPrefix(v)) && path !== ed?.path) {
      try { assertEditorPath(v.root, path) } catch { continue }
      await runPlatform($, windows => removeFile(path, windows))
      removed += 1
    }
  }
  // The app restores the file pane's tabs; close it rather than show a missing file.
  if (removed > 0 && !ed) await closeFilePane($)
}

const closeFilePane = async ($: any) => {
  try { await $.mcp.call('ccd_view', 'close_pane', { pane: 'file' }) } catch { /* not the desktop */ }
}
const bodyFromEditor = (ed: NotesEditing, text: string) => ed.header
  ? editorBody(ed.header, text)
  : editorBodyFromHeaders([
    strings('en').editorHeaderApp, strings('zh').editorHeaderApp,
    strings('en').editorHeader, strings('zh').editorHeader,
  ], text)

// Follow the open editor file: each time it is saved, the note gets the new
// text (a new note is created by the first non-empty save).
let syncing = false
let editorGeneration = 0
const setEditorState = async ($: any, value: NotesEditing | null) => {
  editorGeneration += 1
  await update($, editing, () => value)
}
const syncEditor = async ($: any) => {
  if (syncing) return { ok: false, code: 'SYNCING' }
  syncing = true
  const generation = editorGeneration
  try {
    const ed = await read($, editing)
    const v = await read($, view)
    if (!ed || !v?.root || (ed.mode !== 'editor' && ed.mode !== 'new')) return { ok: true, unchanged: true }
    if (inApp(ed.path)) assertEditorPath(v.root, ed.path)
    if (!(await $.fs.exists(ed.path))) return { ok: false, code: 'EDITOR_MISSING' }
    const body = bodyFromEditor(ed, await $.fs.read(ed.path))
    await update($, editing, cur => (cur && cur.path === ed.path ? editorObservedState(cur, body) : cur))
    if (body === ed.synced) return { ok: true, body }
    if (ed.mode === 'new') return { ok: false, code: 'EDITOR_UNCOMMITTED', body }
    const base = { root: v.root, sessionId: v.sessionId, lane: ed.lane }
    const beforeWrite = async () => {
      const latest = await read($, editing)
      return editorSyncCanWrite(generation, editorGeneration, ed, latest)
    }
    if (!(await beforeWrite())) return { ok: false, code: 'EDITOR_CANCELED', body }
    const written = await editNote(io($), { ...base, ...editorWriteArgs(ed, body), beforeWrite, stillWanted: () => editorGeneration === generation })
    if (written.ok) {
      await update($, editing, cur => (cur && cur.path === ed.path ? editorCommittedState(cur, body, written.version) : cur))
      await loadCards($, v)
      return { ok: true, body, version: written.version }
    }
    if (written.code === 'STALE') await update($, conflict, () => ({ lane: ed.lane, key: ed.key, action: 'edit', body }))
    else if (written.code !== 'EMPTY_CONTENT' && written.code !== 'EDITOR_CANCELED') await say($, failureText(written.code, v, written.detail), true)
    return { ok: false, code: written.code, body }
  } catch (err) {
    const v = await read($, view)
    if (v) await say($, failureText((err as any)?.code ?? 'WRITE_FAILED', v, String(err)), true)
    return { ok: false, code: 'WRITE_FAILED' }
  } finally {
    syncing = false
  }
}

// ---- the conversation transcript -------------------------------------------
// Text blocks of this session's transcript, read incrementally (only what was
// appended since the last read) and kept in this module; `tick` redraws.
type Block = { uuid: string; sessionId: string; role: string; text: string; at: string; renderId: string }
let cache: { path: string; offset: number; tIndex: Map<string, number>; blocks: Block[]; partial: string } | null = null

const pathFor = async ($: any) => {
  const known = await read($, transcriptPath)
  if (known) return normalizePath(known)
  const windows = await isWindows($)
  const home = windows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')
  const cwd = normalizePath(await $.session.cwd())
  return `${normalizePath(home ?? '')}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${await $.session.id()}.jsonl`
}

const streamLines = async ($: any, command: { argv: string[]; env?: Record<string, string> }, onLines: (lines: string[]) => void) => {
  let buf = ''
  let bytes = 0
  for await (const chunk of $.process.spawn(command.env ? { argv: command.argv, env: command.env } : { argv: command.argv })) {
    if (chunk.stream !== 'stdout') continue
    bytes += new TextEncoder().encode(chunk.text).length
    buf += chunk.text
    const parts = buf.split('\n')
    buf = parts.pop() ?? ''
    onLines(parts)
  }
  return { rest: buf, bytes }
}

const loadTranscript = async ($: any): Promise<Block[]> => {
  const path = await pathFor($)
  if (!cache || cache.path !== path) cache = { path, offset: 0, tIndex: new Map(), blocks: [], partial: '' }
  const c = cache
  if (!(await $.fs.exists(path))) return c.blocks
  const size = (await $.fs.stat(path)).size
  if (size < c.offset) { cache = null; return loadTranscript($) }
  if (size === c.offset) return c.blocks
  const lines: string[] = []
  const { rest, bytes } = await streamLines($, readFrom(path, c.offset, await isWindows($)), parts => {
    if (parts.length === 0) return
    parts[0] = c.partial + parts[0]
    c.partial = ''
    lines.push(...parts)
  })
  c.blocks.push(...(parseLines(lines, c.tIndex) as Block[]))
  c.partial = rest
  c.offset += bytes
  return c.blocks
}

// Another conversation's blocks, read whole (only on the person's request).
const loadOther = async ($: any, sessionId: string): Promise<Block[] | null> => {
  const dir = (await pathFor($)).replace(/\/[^/]+$/, '')
  const path = `${dir}/${sessionId}.jsonl`
  if (!(await $.fs.exists(path))) return null
  const lines: string[] = []
  const { rest } = await streamLines($, readAll(path, await isWindows($)), parts => lines.push(...parts))
  if (rest) lines.push(rest)
  return parseLines(lines) as Block[]
}

const readClipboard = async ($: any) => {
  const r = await runPlatform($, clipboard)
  return r.exitCode === 0 ? String(r.stdout) : ''
}

const roleLabel = (role: string) => (role === 'user' ? t('roleUser') : t('roleAssistant'))
const when = (at: string) => {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const toQuote = (snapshot: string, b: Block): NotesQuote =>
  ({ snapshot, source: { sessionId: b.sessionId, messageId: b.uuid }, role: b.role })

// Clipboard → the message(s) of this conversation that contain it. One
// message: attached at once. Several: the find view lists them (as search
// results) to open and choose. The same text as last time asks first.
const quoteClipboard = async ($: any, again = false) => {
  const s = await readClipboard($)
  if (!s.trim()) { await say($, t('clipboardEmpty'), true); return }
  if (!again && s === (await $.store.get('lastQuoted'))) { await update($, reuse, () => s); return }
  await update($, reuse, () => null)
  const found = findQuote(await loadTranscript($), s)
  await update($, tick, k => k + 1)
  if (found.length === 0) { await say($, t('quoteNotFound'), true); return }
  await update($, candidates, () => null)
  if (found.length === 1) { await attachQuote($, s, found[0].block as Block); return }
  await update($, mirror, () => ({ shown: 10, expanded: [], query: '', focus: -1, before: 0, after: 0, sel: null, paste: s }))
}

// The copied text becomes the composer's quote, from message `b`.
const attachQuote = async ($: any, s: string, b: Block) => {
  await update($, toast, cur => (cur?.error ? null : cur))
  await update($, quote, () => toQuote(s, b))
  await update($, mirror, () => null)
  await $.store.set('lastQuoted', s)
}

// Open a note's source: find its message by identity (never by text).
const openSource = async ($: any, laneKey: string, card: NotesCard, allowOther = false) => {
  const src = card.source as { sessionId: string; messageId: string }
  const v = await read($, view)
  const blocks = await loadTranscript($)
  let list: Block[] | null = blocks
  let foreign = false
  if (!blocks.some(b => b.uuid === src.messageId)) {
    if (src.sessionId === v?.sessionId) list = null
    else if (!allowOther) {
      await update($, reentry, () => ({ lane: laneKey, key: card.key, snapshot: card.snapshot ?? '', source: src, status: 'ask', turn: -1, before: 0, after: 0, foreign: true, full: false, open: [] }))
      return
    } else { list = await loadOther($, src.sessionId); foreign = true }
  }
  const turns = list ? toTurns(list) : []
  const turn = turns.findIndex((tr: any) => tr.blocks.some((b: Block) => b.uuid === src.messageId))
  const block = turn >= 0 ? (turns[turn].blocks as Block[]).find(b => b.uuid === src.messageId) : undefined
  const status = !block ? 'unavailable' : locate(block.text, card.snapshot ?? '').ranges.length > 0 ? 'exact' : 'nonexact'
  if (foreign) otherTurns = turns
  await update($, reentry, () => ({ lane: laneKey, key: card.key, snapshot: card.snapshot ?? '', source: src, status, turn, before: 0, after: 0, foreign, full: false, open: [] }))
  if (foreign) void appLinkFor($, src.sessionId).then(link => update($, reentry, cur => (cur && cur.key === card.key ? { ...cur, link } : cur)))
  await update($, spotlight, () => (block && block.role === 'assistant' && !foreign ? { renderId: block.renderId, snapshot: card.snapshot ?? '' } : null))
  await update($, tick, k => k + 1)
}
let otherTurns: any[] = []

// The app's own link to a conversation (claude://…), only when the app
// confirms it knows that conversation; otherwise none is offered.
const appLinkFor = async ($: any, sessionId: string): Promise<string> => {
  try {
    const r = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: `local_${sessionId}` })
    const text = typeof r === 'string' ? r : JSON.stringify(r)
    const m = /"link"\s*:\s*"(claude:\/\/[^"\\]+)"/.exec(text) ?? /(claude:\/\/claude\.ai\/[A-Za-z0-9/_-]+)/.exec(text)
    return m ? m[1] : ''
  } catch { return '' }
}
const openLink = async ($: any, link: string) => {
  const r = await runPlatform($, windows => openLinkCommand(link, windows))
  if (r.exitCode !== 0) await say($, t('openFailed', { detail: String(r.stderr).slice(0, 120) }), true)
}

// "#18 · 10-03 21:57" for a message of this conversation, from the cached
// transcript (empty until it has been read).
let placeIndex: { length: number; map: Map<string, string> } = { length: -1, map: new Map() }
const placeOf = (uuid: string | undefined) => {
  const blocks = cache?.blocks ?? []
  if (placeIndex.length !== blocks.length) {
    const map = new Map<string, string>()
    for (const turn of toTurns(blocks) as any[]) for (const b of turn.blocks) map.set(b.uuid, `#${turn.index + 1} · ${when(b.at)}`)
    placeIndex = { length: blocks.length, map }
  }
  return uuid ? placeIndex.map.get(uuid) ?? '' : ''
}

let watching = false
const watchDisk = ($: any) => {
  if (watching) return
  watching = true
  $.clock.every(5000, async () => {
    const v = await read($, view)
    if (v?.root) await loadCards($, v)
  })
  $.clock.every(1200, () => syncEditor($))
}


// ---- fork carry (D10) -------------------------------------------------------
const markerPath = (v: NotesView) => `${v.root}/.carry-over/${v.sessionId}.json`
const readMarker = async ($: any, v: NotesView) => {
  try { return (await $.fs.exists(markerPath(v))) ? JSON.parse(await $.fs.read(markerPath(v))) : null } catch { return null }
}
const writeMarker = async ($: any, v: NotesView, marker: unknown) => {
  if (!(await rootExists(io($), v.root))) {
    const error = new Error('ROOT_MISSING')
    ;(error as any).code = 'ROOT_MISSING'
    throw error
  }
  const dir = `${v.root}/.carry-over`
  await runPlatform($, windows => makeDirs(dir, windows))
  const tmp = `${dir}/.${v.sessionId}.${Math.random().toString(36).slice(2)}.tmp`
  await $.fs.write(tmp, `${JSON.stringify(marker, null, 2)}\n`)
  const moved = await runPlatform($, windows => moveFile(tmp, markerPath(v), windows))
  if (moved.exitCode !== 0) throw new Error(String(moved.stderr).slice(0, 200))
}

// History membership for the fork cut: ids of this conversation's messages
// (the parent's copied ones included) and of the parent's.
const carryIds = async ($: any, parent: string) => {
  const own = await loadTranscript($)
  const theirs = (await loadOther($, parent)) ?? []
  return { childItemIds: new Set(own.map(b => b.uuid)), parentItemIds: new Set(theirs.map(b => b.uuid)) }
}

// Offer the parent's notes once, in a fork whose parent has notes and whose
// carry is not decided yet.
const detectCarry = async ($: any, v: NotesView) => {
  if (!v.root) return
  const marker = await readMarker($, v)
  if (marker?.status === 'decided') return
  const blocks = await loadTranscript($)
  const order: string[] = []
  for (const b of blocks) if (b.sessionId && order[order.length - 1] !== b.sessionId) order.push(b.sessionId)
  const parent = marker?.parentThreadId ?? forkParent(order, v.sessionId)
  if (!parent || !isSessionId(parent)) return
  const ids = await carryIds($, parent)
  const lanesInfo: Record<string, { offered: number; skipped: number; occupied: boolean }> = {}
  let total = 0
  for (const key of LANE_KEYS) {
    const parentText = (await readLane(io($), lanePath(v.root, key, parent))).text
    const childText = (await readLane(io($), lanePath(v.root, key, v.sessionId))).text
    const plan = planLane({ parentText, childText: '', ...ids })
    lanesInfo[key] = { offered: plan.offered ?? plan.carried, skipped: plan.skipped, occupied: childText.trim().length > 0 }
    total += (plan.offered ?? plan.carried) + plan.skipped
  }
  if (total === 0) return
  await update($, carry, () => ({
    parent, step: 'ask', resume: marker?.status === 'partial', total, lanes: lanesInfo,
    selected: LANE_KEYS.filter((k: string) => lanesInfo[k].offered > 0), modes: {}, choice: '', result: [], error: '',
  }))
}

const decideNone = async ($: any, v: NotesView, c: NotesCarry) => {
  try {
    await writeMarker($, v, carryMarker(c.parent, Object.fromEntries(LANE_KEYS.map((k: string) => [k, { outcome: 'skipped', carriedKeys: [] }])), 'decided', { choice: 'none', selectedLanes: [] }))
    await update($, carry, () => null)
    await say($, t('carryNoneDone'))
  } catch (err) {
    await update($, carry, cur => (cur ? { ...cur, error: (err as any)?.code === 'ROOT_MISSING' ? t('rootMissing', { path: v.root }) : t('carryFailed', { detail: String(err).slice(0, 120) }) } : cur))
  }
}

// Bring the chosen lanes over. A lane the branch already uses needs a mode
// first. The marker records each lane's planned keys before the lane is
// written, so a retry never duplicates a lane that was already written.
const applyCarry = async ($: any, v: NotesView, c: NotesCarry, choice: string, chosen: string[]) => {
  // Whether a lane is in use is read now: the branch may have gained notes
  // since the question was first shown.
  const lanesNow = { ...c.lanes }
  for (const k of chosen) {
    const text = (await readLane(io($), lanePath(v.root as string, k, v.sessionId))).text
    lanesNow[k] = { ...lanesNow[k], occupied: text.trim().length > 0 }
  }
  const prior = await readMarker($, v)
  const needs = chosen.filter(k => laneAlreadyHandled(prior?.lanes?.[k], '') === 'open' && lanesNow[k].occupied && lanesNow[k].offered > 0 && !c.modes[k])
  if (needs.length > 0) { await update($, carry, cur => (cur ? { ...cur, lanes: lanesNow, step: 'conflict', choice, selected: chosen, error: '' } : cur)); return }
  try {
    const ids = await carryIds($, c.parent)
    const markerLanes: Record<string, { outcome: string; carriedKeys: string[]; committed?: boolean }> = {}
    for (const k of LANE_KEYS) markerLanes[k] = prior?.lanes?.[k] ?? { outcome: chosen.includes(k) ? 'pending' : 'skipped', carriedKeys: [] }
    const result: { lane: string; outcome: string; carried: number; skipped: number }[] = (c.result ?? []).filter(r => !chosen.includes(r.lane))
    const ambiguous: string[] = []
    for (const k of chosen) {
      const path = lanePath(v.root as string, k, v.sessionId)
      const childRead = await readLane(io($), path)
      const handled = laneAlreadyHandled(markerLanes[k], childRead.text)
      if (handled === 'committed') {
        result.push({ lane: k, outcome: 'handled', carried: (markerLanes[k].carriedKeys ?? []).length, skipped: c.lanes[k].skipped })
        continue
      }
      if (handled === 'ambiguous') { ambiguous.push(k); continue }
      const parentText = (await readLane(io($), lanePath(v.root as string, k, c.parent))).text
      const plan = planLane({ parentText, childText: childRead.text, ...ids, mode: c.modes[k] ?? null })
      if (plan.needsChoice) {
        await update($, carry, cur => (cur ? { ...cur, lanes: { ...lanesNow, [k]: { ...lanesNow[k], occupied: true } }, step: 'conflict', choice, selected: chosen, error: '' } : cur))
        return
      }
      markerLanes[k] = { outcome: plan.outcome, carriedKeys: plan.carriedKeys, committed: false }
      await writeMarker($, v, carryMarker(c.parent, markerLanes, 'partial', { choice, selectedLanes: chosen }))
      if (plan.text !== childRead.text) {
        const written = await writeLane(io($), v.root as string, path, childRead.version, plan.text)
        if (!written.ok) {
          markerLanes[k] = { outcome: 'pending', carriedKeys: [] }
          try { await writeMarker($, v, carryMarker(c.parent, markerLanes, 'partial', { choice, selectedLanes: chosen })) } catch { /* retry remains best effort */ }
          await detectCarry($, v)
          await update($, carry, cur => (cur ? { ...cur, error: written.code === 'STALE' ? t('carryStale') : t('carryFailed', { detail: written.detail ?? written.code }) } : cur))
          await loadCards($, v)
          return
        }
      }
      markerLanes[k] = { ...markerLanes[k], committed: true }
      await writeMarker($, v, carryMarker(c.parent, markerLanes, 'partial', { choice, selectedLanes: chosen }))
      result.push({ lane: k, outcome: plan.outcome, carried: plan.carried, skipped: plan.skipped })
    }
    if (ambiguous.length === 0) await writeMarker($, v, carryMarker(c.parent, markerLanes, 'decided', { choice, selectedLanes: chosen }))
    await loadCards($, v)
    await update($, carry, cur => (cur ? { ...cur, step: ambiguous.length ? 'ambiguous' : 'done', ambiguous, result, error: '' } : cur))
  } catch (err) {
    await update($, carry, cur => (cur ? { ...cur, error: (err as any)?.code === 'ROOT_MISSING' ? t('rootMissing', { path: v.root }) : t('carryFailed', { detail: String(err).slice(0, 120) }) } : cur))
  }
}

const bringAmbiguousAgain = async ($: any, v: NotesView, c: NotesCarry, key: string) => {
  const marker = await readMarker($, v)
  const markerLanes = { ...(marker?.lanes ?? {}), [key]: resetCarryLane(marker?.lanes?.[key] ?? { outcome: 'pending', carriedKeys: [] }) }
  await writeMarker($, v, carryMarker(c.parent, markerLanes, 'partial', { choice: c.choice, selectedLanes: c.selected }))
  const retry = { ...c, step: 'ask' as const, ambiguous: (c.ambiguous ?? []).filter(k => k !== key) }
  await update($, carry, () => retry)
  await applyCarry($, v, retry, c.choice, [...new Set([key, ...(retry.ambiguous ?? [])])])
}

const skipAmbiguousLane = async ($: any, v: NotesView, c: NotesCarry, key: string) => {
  const marker = await readMarker($, v)
  const markerLanes = { ...(marker?.lanes ?? {}), [key]: { outcome: 'skipped', carriedKeys: [], committed: true } }
  const ambiguous = (c.ambiguous ?? []).filter(k => k !== key)
  await writeMarker($, v, carryMarker(c.parent, markerLanes, ambiguous.length ? 'partial' : 'decided', { choice: c.choice, selectedLanes: c.selected }))
  const result = [...(c.result ?? []), { lane: key, outcome: 'skipped', carried: 0, skipped: c.lanes[key]?.offered ?? 0 }]
  await update($, carry, () => ({ ...c, step: ambiguous.length ? 'ambiguous' : 'done', ambiguous, result, error: '' }))
}

// ---- reopening a pane the person closed (as in Codex) ----------------------
// Closed by hand, the pane comes back with a message sent at least 5 minutes
// later; sooner, the person meant it.
let closedAt = 0
const REOPEN_AFTER = 5 * 60 * 1000

// ---- ticked notes and the agent tools ---------------------------------------
// Prompts typed by a person (not notifications, peers or schedules).
const HUMAN = new Set(['composer', 'bridge', 'sdk', 'unclassified'])

// Bind only a unique exact-text user message appended after the transcript
// snapshot taken once prompt.submit's next handler has resolved.
const bindMark = async ($: any, v: NotesView, mark: NotesMark, baseline: number) => {
  for (const wait of [800, 1500, 3000, 6000]) {
    await $.clock.sleep(wait)
    let blocks: Block[]
    try { blocks = await loadTranscript($) } catch { continue }
    const match = uniqueUserMessageAfter(blocks, mark.text, baseline)
    if (!match) continue
    await update($, marks, cur => ({ ...cur, [match.uuid]: mark }))
    await $.store.set(marksKey(v), await read($, marks))
    return
  }
}

// The ticked notes, read fresh from disk, in tick order.
const tickedNotes = async ($: any, v: NotesView, chosen: string[]) => {
  const lanesRead: Record<string, NotesCard[]> = {}
  const items: { lane: string; card: NotesCard }[] = []
  const missing: string[] = []
  for (const id of chosen) {
    const [laneKey, key] = splitTick(id)
    if (!lanesRead[laneKey]) lanesRead[laneKey] = readCards((await readLane(io($), lanePath(v.root as string, laneKey, v.sessionId))).text) as NotesCard[]
    const card = lanesRead[laneKey].find(c => c.key === key)
    if (card) items.push({ lane: laneKey, card })
    else missing.push(id)
  }
  return { items, missing }
}

const TOOLS = [
  {
    name: 'notes-read',
    description: 'Collaborative Notes: read one lane of this conversation\'s notes (the user\'s side panel). Returns each note\'s itemKey, authored text, optional quoted sourceSnapshot and source, and the lane version for notes-edit. Pass `session` only for another conversation the user named in this request (read-only).',
    inputSchema: { type: 'object', properties: { lane: { type: 'string', description: 'L1-L4, or the lane name' }, session: { type: 'string', description: 'Another conversation\'s session id, only when the user asked for it' } }, required: ['lane'] },
  },
  {
    name: 'notes-write',
    description: 'Collaborative Notes: create one plain note the user asked for (or accepted) in a lane of this conversation. Never for capture the user did not ask for. Cannot quote; quoted notes are made by the user in the panel.',
    inputSchema: { type: 'object', properties: { lane: { type: 'string', description: 'L1-L4, or the lane name' }, content: { type: 'string' } }, required: ['lane', 'content'] },
  },
  {
    name: 'notes-edit',
    description: 'Collaborative Notes: change one note\'s authored text. Read the lane first and pass its itemKey and version as expectedVersion; a quoted note keeps its quote.',
    inputSchema: { type: 'object', properties: { lane: { type: 'string' }, itemKey: { type: 'string' }, content: { type: 'string' }, expectedVersion: { type: 'string' } }, required: ['lane', 'itemKey', 'content', 'expectedVersion'] },
  },
  {
    name: 'notes-source-reentry',
    description: 'Collaborative Notes: read a quoted note\'s exact source message (found by its stored identity, never by text) and nearby turns. contextWindow: turns on each side (0-30). before/after: any number on one side when the user asks to read further. `session` selects the conversation holding the note. Reading a source transcript outside the current conversation additionally requires `readOtherConversation: true`, and only when the user asked to read that source.',
    inputSchema: { type: 'object', properties: { lane: { type: 'string' }, itemKey: { type: 'string' }, contextWindow: { type: 'number' }, before: { type: 'number' }, after: { type: 'number' }, session: { type: 'string' }, readOtherConversation: { type: 'boolean', default: false, description: 'Set true only when the user asked to read this source in another conversation.' } }, required: ['lane', 'itemKey'] },
  },
  {
    name: 'notes-open-panel',
    description: 'Collaborative Notes: open the Notes pane beside the conversation. Only when the user explicitly asks to open Notes.',
    inputSchema: { type: 'object', properties: {} },
  },
]

const fail = (error: string, message: string) => ({ result: { ok: false, error, message } })
const CODES: Record<string, string> = {
  STALE: 'NOTES_STALE_VERSION', ITEM_UNRESOLVED: 'NOTES_ITEM_NOT_FOUND', ITEM_AMBIGUOUS: 'NOTES_ITEM_AMBIGUOUS',
  EMPTY_CONTENT: 'NOTES_EMPTY_CONTENT', ROOT_MISSING: 'NOTES_STORAGE_UNAVAILABLE', WRITE_FAILED: 'NOTES_STORAGE_UNAVAILABLE',
}

const runTool = async ($: any, name: string, a: any) => {
  if (name === 'notes-open-panel') {
    const opened = await openPane($)
    return { result: { ok: Boolean(opened.isPlaced), ...(opened.isPlaced ? {} : { message: String(opened.reason ?? '') }) } }
  }
  const v = (await read($, view))?.root ? (await read($, view)) as NotesView : await currentView($)
  if (!v.root) return fail('NOTES_SETUP_REQUIRED', 'Notes is not set up for this project. Ask the user to finish the one-time setup in the Notes pane (/notes).')
  const laneKey = resolveLane(a.lane, Object.fromEntries(lanes.map((entry: any) => [entry.descriptive, entry.key])))
  if (!laneKey) return fail('NOTES_INVALID_LANE', 'lane must be L1-L4 or a lane name.')
  if (a.session !== undefined && !isSessionId(a.session)) return fail('NOTES_INVALID_SESSION', 'session must be a session id.')
  const holder = a.session ?? v.sessionId
  const other = holder !== v.sessionId
  if (!(await $.fs.exists(v.root))) return fail('NOTES_STORAGE_UNAVAILABLE', 'The notes folder cannot be reached. Nothing was changed; do not recreate it.')
  const laneRead = await readLane(io($), lanePath(v.root, laneKey, holder))
  const list = readCards(laneRead.text) as NotesCard[]

  if (name === 'notes-read') {
    return { result: { ok: true, lane: laneKey, version: laneRead.version, ...(other ? { readOnly: true } : {}), notes: list.map(noteView) } }
  }
  if (name === 'notes-write') {
    if (other) return fail('NOTES_READ_ONLY', 'Another conversation\'s notes are read-only.')
    if (typeof a.content !== 'string' || !a.content.trim()) return fail('NOTES_EMPTY_CONTENT', 'A note needs some text.')
    const written = await addPlainNote(io($), { root: v.root, lane: laneKey, sessionId: v.sessionId, body: a.content })
    if (!written.ok) return fail(CODES[written.code] ?? written.code, String(written.detail ?? written.code))
    await loadCards($, v)
    return { result: { ok: true, lane: laneKey, itemKey: written.key, shown: 'The Notes pane already shows it; no refresh is needed.' } }
  }
  const card = list.find(c => c.key === a.itemKey)
  if (name === 'notes-edit') {
    if (other) return fail('NOTES_READ_ONLY', 'Another conversation\'s notes are read-only.')
    if (!card) return fail('NOTES_ITEM_NOT_FOUND', 'No note with that itemKey in this lane; read the lane again.')
    if (card.kind === 'legacy') return fail('NOTES_ITEM_NOT_EDITABLE', 'Earlier text is read-only.')
    if (typeof a.content !== 'string') return fail('NOTES_INVALID_CONTENT', 'content must be text.')
    const written = await editNote(io($), { root: v.root, lane: laneKey, sessionId: v.sessionId, key: card.key, expected: a.expectedVersion, body: a.content })
    if (!written.ok) return fail(CODES[written.code] ?? written.code, written.code === 'STALE' ? 'The lane changed since it was read. Read it again, check the user\'s intent still applies, then retry once.' : String(written.detail ?? written.code))
    await loadCards($, v)
    return { result: { ok: true, lane: laneKey, itemKey: card.key, shown: 'The Notes pane already shows it; no refresh is needed.' } }
  }
  if (name === 'notes-source-reentry') {
    if (!card) return fail('NOTES_ITEM_NOT_FOUND', 'No note with that itemKey in this lane; read the lane again.')
    if (!card.source) return fail('NOTES_NO_SOURCE', 'This note has no quoted source.')
    const src = card.source as { sessionId: string; messageId: string }
    // The current conversation first, by message id: a branch keeps its
    // parent's messages, so a carried note's source is usually here.
    const own = await loadTranscript($)
    const here = own.some(b => b.uuid === src.messageId)
    if (!here && !sourceReadAllowed(v.sessionId, src.sessionId, a.readOtherConversation)) {
      return { result: { ok: true, source: 'unauthorized', sourceSnapshot: card.snapshot, message: 'The source is in another conversation. Pass `readOtherConversation: true` only when the user asked to read that source.' } }
    }
    const blocks: Block[] | null = here || src.sessionId === v.sessionId
      ? own
      : isSessionId(src.sessionId) ? await loadOther($, src.sessionId) : null
    return { result: { ok: true, ...reentryResult(blocks ? toTurns(blocks) : null, src, card.snapshot ?? '', a) } }
  }
  return fail('NOTES_UNKNOWN_TOOL', name)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await initLanguage($)
    await $.command.register({ name: 'notes', description: t('title') })
    await Promise.all(TOOLS.map(tool => $.tool.register(tool)))
    const v = await currentView($)
    if (v.root) {
      await update($, view, () => v)
      void $.ui.open({ id: PANE, title: t('title') })
      void (async () => {
        await showBound($, v)
        await cleanEditing($, v)
        watchDisk($)
        await loadTranscript($)
        await update($, tick, k => k + 1)
        await detectCarry($, v)
      })()
    } else if (await takeHint(io($), v.project)) {
      $.ui.toast(t('hint'), { timeoutMs: 8000 })
    }
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const path = (e as any).transcript_path
    if (typeof path === 'string' && path) await update($, transcriptPath, () => path)
    return next(e)
  })

  // While a note's source is being shown, mark the quote in place in the
  // transcript too (the block is drawn as plain text with the matches marked).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const spot = await read($, spotlight)
    if (!spot || e.requestId !== spot.renderId) return next(e)
    const { Box, Text } = $.ui.resolve(e) as any
    const { lines } = highlightRuns(e.props.text, spot.snapshot)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        {lines.map((line: any[]) => <Text>{line.map((run: any) => (run.mark ? <Text backgroundColor="yellow" color="black">{run.text}</Text> : run.text))}</Text>)}
        <Text dimColor>↖ {t('title')}</Text>
      </Box>
    )
  })

  // One click above the prompt to quote what was just copied.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (!v?.root) return next(e)
    const held = await read($, ticks)
    await read($, lang)
    const { Box, Button, Text } = $.ui.resolve(e) as any
    return (
      <Box gap={2} flexWrap="wrap">
        <Button key="band-quote" plain label={t('quoteCopied')} onPress={async () => {
          await $.ui.open({ id: PANE, title: t('title') })
          await quoteClipboard($)
        }} />
        {held.length > 0
          ? <Box gap={1}>
            <Text color="magenta">{t('bandTicked', { n: held.length })}</Text>
            <Button key="band-clear" plain dimColor label={t('clearTicks')} onPress={() => setTicks($, v, () => [])} />
          </Box>
          : null}
      </Box>
    )
  })

  on('tool.call', async ($, e, next) => {
    const m = /^mcp__.*collaborative-notes.*__(notes-[a-z-]+)$/.exec(String((e as any).tool))
    if (!m) return next(e)
    // The host takes a tool's result as text: the answer goes out as JSON.
    let answer
    try {
      answer = await runTool($, m[1], e)
    } catch (err) {
      answer = fail('NOTES_FAILED', String(err).slice(0, 300))
    }
    return { result: JSON.stringify(answer.result, null, 1) }
  })

  // Ticked notes go with the next message the person sends, as context the
  // model reads and the person does not see. If they cannot be attached the
  // message is held back and the ticks stay.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if ((e as any).origin?.kind === 'person') closedAt = Date.now()
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // `/notes` that reached the prompt as text (the command was not ready yet).
    if (e.text.trim() === '/notes' && HUMAN.has((e as any).origin?.kind)) {
      await openPane($)
      return { drop: t('title') }
    }
    if (closedAt && HUMAN.has((e as any).origin?.kind) && Date.now() - closedAt >= REOPEN_AFTER) {
      closedAt = 0
      if ((await read($, view))?.root) void openPane($)
    }
    const chosen = await read($, ticks)
    if (chosen.length === 0 || !HUMAN.has((e as any).origin?.kind)) return next(e)
    const v = await read($, view)
    if (!v?.root) return { drop: t('attachFailed', { detail: 'Notes is not set up' }) }
    let picked
    try {
      picked = await tickedNotes($, v, chosen)
    } catch (err) {
      return { drop: t('attachFailed', { detail: String(err).slice(0, 120) }) }
    }
    if (picked.missing.length > 0) {
      await setTicks($, v, cur => cur.filter(id => !picked.missing.includes(id)))
      return { drop: t('attachMissing', { n: picked.missing.length }) }
    }
    // What the transcript holds before this prompt enters: the receipt binds
    // only to a message that appears after it.
    let baseline = -1
    try { baseline = (await loadTranscript($)).length } catch { /* no baseline: no receipt */ }
    const result = await next({ ...e, context: [...(e.context ?? []), referenceText(picked.items, laneLabel)] })
    if ((result as any).drop) return result
    await setTicks($, v, () => [])
    if (canBindReceipt(e.turnId, baseline)) void bindMark($, v, { text: e.text, notes: picked.items.map(({ card }) => excerpt(card)) }, baseline).catch(() => {})
    return result
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const all = await read($, marks)
    await read($, lang)
    const mark = all[e.requestId]
    const drawn = await next(e)
    if (!mark) return drawn
    const { Box, Text } = $.ui.resolve(e) as any
    return (
      <Box flexDirection="column">
        {drawn}
        <Text dimColor>{t('attachedMark', { n: mark.notes.length, list: mark.notes.map(x => `“${x}”`).join(' · ') })}</Text>
      </Box>
    )
  })

  // A click in the pane would first move the focus ring and redraw, which
  // swallowed the click; keep the ring still so one click presses.
  on('ui.focus', { requestId: PANE }, () => ({}))

  on('command.run', { command: 'notes' }, async $ => {
    const opened = await openPane($)
    return { text: opened.isPlaced ? t('title') : `${t('title')}: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    try {
      return await renderPane($, e)
    } catch (err) {
      // Never leave the pane blank: say what failed and offer a way back.
      const { Box, Text, Button } = $.ui.resolve(e) as any
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="red">{t('renderFailed')}</Text>
          <Text dimColor>{String(err).slice(0, 300)}</Text>
          <Button key="reset-view" variant="primary" label={t('backToNotes')} onPress={async () => {
            await update($, mirror, () => null)
            await update($, reentry, () => null)
            await update($, spotlight, () => null)
            await update($, search, () => null)
            await update($, candidates, () => null)
          }} />
        </Box>
      )
    }
  })
}

const renderPane = async ($: any, e: any) => {
    const { Box, Text, Button, Input, Select, Markdown } = $.ui.resolve(e) as any
    const v = await read($, view)
    const note = await read($, toast)
    if (!v) return <Text dimColor>…</Text>

    const banner = note
      ? <Box paddingX={1} borderStyle="round" borderColor={note.error ? 'red' : 'green'}><Text color={note.error ? 'red' : undefined}>{note.text}</Text></Box>
      : null

    // ---- setup gate ------------------------------------------------------
    if (!v.root && v.setup) {
      // A setup kept from an older version may lack the newer fields.
      const s = { ...v.setup, browsePath: v.setup.browsePath ?? v.project, folders: v.setup.folders ?? [], laneNames: v.setup.laneNames ?? lanes.map((entry: any) => entry.descriptive) }
      const bind = async () => {
        if (s.notDir) return
        const stored = await $.store.get('laneConfig')
        const existing = sanitizeLaneConfig(stored ?? {})
        if (!existing.ok) { await say($, t('laneNamesInvalid'), true); return }
        const source = existing.config
        const overrides = source.laneOverrides
        const merged: any = {
          ...source,
          displayOrder: source.displayOrder ?? [],
          laneOverrides: { ...overrides },
        }
        const defaults = defaultLabels(language)
        lanes.forEach((entry: any, index: number) => {
          const name = String(s.laneNames[index] ?? '').trim() || entry.descriptive
          const override = { ...(merged.laneOverrides[entry.key] ?? {}) }
          if (name === defaults[entry.key]) delete override.label
          else override.label = name
          merged.laneOverrides[entry.key] = override
        })
        const checked = sanitizeLaneConfig(merged)
        if (!checked.ok) { await say($, t('laneNamesInvalid'), true); return }
        if (!s.exists && !(await createRoot(io($), s.candidate))) { await say($, t('setupFailed'), true); return }
        await $.store.set('laneConfig', checked.config)
        laneConfig = checked.config
        lanes = resolveLanes(laneConfig, language)
        await setBinding(io($), v.project, s.candidate)
        await showBound($, { ...v, root: s.candidate, setup: null })
        watchDisk($)
      }
      const openBrowser = async () => {
        await update($, view, (cur: NotesView | null) => cur?.setup ? {
          ...cur, setup: { ...cur.setup, other: true, browsePath: cur.project, folders: [] },
        } : cur)
        await browseTo($, v.project)
      }
      const useBrowsedFolder = async () => {
        const current = await read($, view)
        if (current?.setup) await startSetup($, current, current.setup.browsePath, true)
      }
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{t('setupTitle')}</Text>
          {banner}
          <Text>{t('setupIntro')}</Text>
          <Text dimColor>{t('setupProposed')}</Text>
          <Text bold>{s.candidate}</Text>
          {s.lanes.length > 0 ? <Text>{t('setupExisting', { lanes: s.lanes.length })}</Text> : null}
          {s.nested
            ? <Box flexDirection="column">
              <Text color="yellow">{t('setupNested', { path: s.nested })}</Text>
              <Button key="setup-nested" variant="primary" label={t('setupUseNested')} onPress={() => startSetup($, v, s.nested as string, s.other)} />
            </Box>
            : null}
          {s.notDir ? <Text color="red">{t('setupNotDir')}</Text> : null}
          {s.other
            ? <Box flexDirection="column" gap={1}>
              <Text bold>{s.browsePath}</Text>
              <Box gap={1}>
                {!isRootPath(s.browsePath) ? <Button key="browse-up" plain label={t('browseUp')} onPress={() => browseTo($, parentFolder(s.browsePath))} /> : null}
                <Button key="browse-use" variant="primary" label={t('browseUse')} onPress={useBrowsedFolder} />
              </Box>
              {s.folders.length
                ? s.folders.map((name: string) => <Button key={`browse-${name}`} plain dimColor={name.startsWith('.')} label={`📁 ${name}`} onPress={() => browseTo($, childFolder(s.browsePath, name))} />)
                : <Text dimColor>{t('browseEmpty')}</Text>}
              <Input key="browse-new-folder" placeholder={t('browseNewPlaceholder')} label={t('browseNew')} submitLabel={t('browseNewSubmit')} onSubmit={async (value: string) => {
                if (!validFolderName(value)) { await say($, t('setupInvalid'), true); return }
                const name = value.trim()
                const path = childFolder(s.browsePath, name)
                try {
                  const result = await runPlatform($, windows => makeDir(path, windows))
                  if (result.exitCode !== 0) { await say($, t('browseCreateFailed'), true); return }
                  await browseTo($, path)
                } catch { await say($, t('browseCreateFailed'), true) }
              }} />
              <Input key="setup-path" placeholder={t('setupOtherPlaceholder')} submitLabel={t('setupOtherSubmit')} onSubmit={async (value: string) => {
                const candidate = resolveLocation(v.project, value)
                if (!candidate) { await say($, t('setupInvalid'), true); return }
                const current = await read($, view)
                await startSetup($, current ?? v, candidate, true)
              }} />
            </Box>
            : null}
          <Text bold>{t('laneNamesTitle')}</Text>
          <Text dimColor>{t('laneNamesHint')}</Text>
          {lanes.map((entry: any, index: number) => <Input
            key={`setup-lane-${entry.key}`}
            label={`${entry.displayId}`}
            value={s.laneNames[index]}
            onInput={(value: string) => update($, view, (cur: NotesView | null) => cur?.setup ? {
              ...cur, setup: { ...cur.setup, laneNames: (cur.setup.laneNames ?? s.laneNames).map((name: string, at: number) => at === index ? value : name) },
            } : cur)}
            onSubmit={(value: string) => update($, view, (cur: NotesView | null) => cur?.setup ? {
              ...cur, setup: { ...cur.setup, laneNames: (cur.setup.laneNames ?? s.laneNames).map((name: string, at: number) => at === index ? value : name) },
            } : cur)} />)}
          <Box gap={1}>
            {s.notDir ? null : <Button key="setup-use" variant="primary" label={t('setupUse')} onPress={bind} />}
            {s.other
              ? <Button key="setup-back" plain label={t('setupBack')} onPress={() => startSetup($, v, proposedRoot(v.project))} />
              : <Button key="setup-other" plain label={t('setupOther')} onPress={openBrowser} />}
            {s.previous
              ? <Button key="setup-cancel" plain label={t('cancel')} onPress={async () => { await showBound($, { ...v, root: s.previous as string, setup: null }) }} />
              : null}
          </Box>
        </Box>
      )
    }

    // ---- notes ------------------------------------------------------------
    const current = await read($, lane)
    const order = await read($, sort)
    const all = await read($, cards)
    const n = await read($, composer)
    const vers = await read($, versions)
    const pinned = await read($, pins)
    const ed = await read($, editing)
    const confirming = await read($, confirm)
    const query = await read($, search)
    const clash = await read($, conflict)
    const q = await read($, quote)
    const cands = await read($, candidates)
    const mir = await read($, mirror)
    const held = await read($, ticks)
    const langNow = await read($, lang)
    const showHelp = await read($, help)
    const fork = await read($, carry)
    const again = await read($, reuse)
    const back = await read($, reentry)
    const opened = await read($, openSources)
    await read($, tick)
    const root = v.root as string
    const base = { root, sessionId: v.sessionId }

    const save = async (value: string, laneKey = current, afterPersist?: () => Promise<void>) => {
      const body = value.replace(/^\s*\n|\s+$/g, '')
      if (!body.trim() && !q) { await say($, t('emptyBody'), true); return false }
      const written = await addPlainNote(io($), { ...base, lane: laneKey, body, quote: q ? { snapshot: q.snapshot, source: q.source } : undefined })
      if (!written.ok) { await say($, failureText(written.code, v, written.detail), true); return false }
      try {
        if (afterPersist) await afterPersist()
        await update($, quote, () => null)
        await update($, composer, k => k + 1)
        await say($, t('saved'))
        await loadCards($, v)
      } catch {
        try { await say($, t('saveRefreshFailed'), true) } catch { /* persistence already succeeded */ }
      }
      return true
    }

    const applyEdit = async (laneKey: string, key: string, body: string, expected: string, overwrite = false) => {
      const written = await editNote(io($), { ...base, lane: laneKey, key, expected, body, overwrite })
      if (written.ok) {
        await setEditorState($, null)
        await update($, conflict, () => null)
        await loadCards($, v)
        await say($, t('edited'))
      } else if (written.code === 'STALE') {
        await update($, conflict, () => ({ lane: laneKey, key, action: 'edit', body }))
      } else {
        if (written.code === 'ITEM_UNRESOLVED') { await setEditorState($, null); await loadCards($, v) }
        await say($, failureText(written.code, v, written.detail), true)
      }
    }

    const remove = async (laneKey: string, key: string) => {
      const written = await deleteNote(io($), { ...base, lane: laneKey, key, expected: vers[laneKey] })
      await update($, confirm, () => '')
      if (written.ok) {
        await loadCards($, v)
        await say($, t('deleted'))
      } else if (written.code === 'STALE') {
        await update($, conflict, () => ({ lane: laneKey, key, action: 'delete', body: '' }))
      } else {
        await loadCards($, v)
        await say($, failureText(written.code, v, written.detail), true)
      }
    }

    const togglePin = async (key: string) => {
      const isOn = pinned.includes(key)
      const next = isOn ? pinned.filter(k => k !== key) : [...pinned, key]
      await $.store.set(pinKey(v), next)
      await update($, pins, () => next)
      await say($, isOn ? t('unpinned') : t('pinned'))
    }

    // Write the body (with a header line) to a temporary file and open it for
    // editing: in the app's file pane beside the conversation when the notes
    // root is inside the project, else in the system text editor. `key` is
    // empty for a new note.
    const openEditor = async (laneKey: string, key: string, body: string, mode: string) => {
      const cwd = await $.session.cwd()
      const currentDirectory = normalizePath(cwd)
      const currentRoot = normalizePath(root)
      if (currentRoot.startsWith(`${currentDirectory}/`)) {
        if (!(await rootExists(io($), currentRoot))) { await say($, t('rootMissing', { path: currentRoot }), true); return }
        const path = await editorPath(currentRoot, editPrefix(v), key || `new-${Date.now().toString(36)}`)
        const header = t('editorHeaderApp')
        await $.fs.write(path, editorFile(header, body))
        try {
          const shown = await $.mcp.call('ccd_view', 'show_pane', { pane: 'file', path, line: 3 })
          if (!shown?.isError) {
            await setEditorState($, { lane: laneKey, key, expected: vers[laneKey], mode, path, synced: mode === 'new' ? '' : body, observed: body, header })
            return
          }
        } catch { /* no desktop file pane here: fall back to the text editor */ }
        await runPlatform($, windows => removeFile(path, windows))
      }
      const made = await runPlatform($, windows => tempFile('collaborative-note', windows))
      const path = made.stdout.trim()
      if (made.exitCode !== 0 || !path) { await say($, t('editorFailed', { detail: made.stderr.slice(0, 120) }), true); return }
      const header = t('editorHeader')
      await $.fs.write(path, editorFile(header, body))
      const opened = await runPlatform($, windows => openInEditor(path, windows))
      if (opened.exitCode !== 0) { await say($, t('editorFailed', { detail: opened.stderr.slice(0, 120) }), true); return }
      await setEditorState($, { lane: laneKey, key, expected: vers[laneKey], mode, path, synced: mode === 'new' ? '' : body, observed: body, header })
    }

    const finishEditor = async () => {
      const active = await read($, editing)
      if (!active) return
      editorGeneration += 1
      const result = await syncEditor($)
      if (!result.ok) {
        if (result.code === 'EDITOR_UNCOMMITTED') await say($, t('editorUncommitted'), true)
        else if (result.code === 'EDITOR_MISSING') {
          if (editorMissingFinish(active) === 'close') { await closeFilePane($); await setEditorState($, null); return }
          await say($, t('writeFailed', { detail: 'The editor file is missing; its draft remains open.' }), true)
        }
        else if (result.code === 'EMPTY_CONTENT') await say($, failureText(result.code, v), true)
        else if (result.code === 'SYNCING') await say($, t('editorUncommitted'), true)
        return
      }
      const latest = await read($, editing)
      if (!latest) return
      if (!editorCanFinish(latest)) {
        await say($, t('editorUncommitted'), true)
        return
      }
      if (latest.path && inApp(latest.path)) {
        if (!(await removeEditorFile(latest))) return
      }
      await setEditorState($, null)
    }

    const finishSavedEditor = async (active: NotesEditing) => {
      const completed = savedNewEditorCleanup(active)
      await setEditorState($, completed.state)
      if (completed.path && inApp(completed.path)) {
        let cleanupFailed = false
        let validPath = true
        try { assertEditorPath(root, completed.path) } catch { cleanupFailed = true; validPath = false }
        try {
          const closed = await $.mcp.call('ccd_view', 'close_pane', { pane: 'file' })
          if (closed?.isError) cleanupFailed = true
        } catch { cleanupFailed = true }
        if (validPath) {
          try {
            const removed = await runPlatform($, windows => removeFile(completed.path, windows))
            if (removed.exitCode !== 0) cleanupFailed = true
          } catch { cleanupFailed = true }
        }
        if (cleanupFailed) await say($, t('writeFailed', { detail: 'The note was saved, but the editor cleanup did not finish.' }), true)
      }
    }

    const discardEditor = async () => {
      const latest = await read($, editing)
      await setEditorState($, null)
      if (latest?.path && inApp(latest.path)) await removeEditorFile(latest)
    }

    const removeEditorFile = async (active: NotesEditing) => {
      assertEditorPath(root, active.path)
      await closeFilePane($)
      try {
        const removed = await runPlatform($, windows => removeFile(active.path, windows))
        if (removed.exitCode === 0) return true
        await say($, t('writeFailed', { detail: removed.stderr.slice(0, 120) || 'The editor file could not be removed.' }), true)
      } catch (err) {
        await say($, t('writeFailed', { detail: String(err).slice(0, 120) }), true)
      }
      return false
    }


    const highlight = (text: string) => {
      if (!query) return text
      const lower = text.toLowerCase()
      const q = query.toLowerCase()
      const parts: any[] = []
      let at = 0
      let hit = lower.indexOf(q)
      while (hit >= 0) {
        if (hit > at) parts.push(text.slice(at, hit))
        parts.push(<Text backgroundColor="yellow" color="black">{text.slice(hit, hit + q.length)}</Text>)
        at = hit + q.length
        hit = lower.indexOf(q, at)
      }
      if (at < text.length) parts.push(text.slice(at))
      return parts
    }

    const renderCard = (laneKey: string, card: NotesCard, showLane: boolean) => {
      const isPinned = pinned.includes(card.key)
      const isEditing = ed?.key === card.key && ed?.lane === laneKey
      const editable = card.kind !== 'legacy'
      return (
        <Box key={`card-${laneKey}-${card.key}`} flexDirection="column" borderStyle="round"
          borderColor={isPinned ? 'blue' : 'gray'} paddingX={1}>
          {showLane ? <Text dimColor>{laneLabel(laneKey)}</Text> : null}
          {card.kind === 'legacy' ? <Text dimColor>{t('legacy')}</Text> : null}
          {isEditing && ed?.mode === 'inline'
            ? <Input key={`edit-${card.key}`} value={card.body} submitLabel={t('saveEdit')} autoFocus
              onSubmit={(value: string) => applyEdit(laneKey, card.key, value, ed.expected)} />
            : <Box flexDirection="column">
              <Box justifyContent="space-between">
                <Text bold color="blue">{`${isPinned ? '📌 ' : ''}${t('noteLabel')}`}</Text>
                {card.kind !== 'legacy'
                  ? (held.includes(tickId(laneKey, card.key))
                    ? <Button key={`tick-${laneKey}-${card.key}`} variant="primary" label={t('tickOn')} onPress={() => setTicks($, v, cur => cur.filter(x => x !== tickId(laneKey, card.key)))} />
                    : <Button key={`tick-${laneKey}-${card.key}`} plain label={t('tickOff')} onPress={() => setTicks($, v, cur => [...cur.filter(x => x !== tickId(laneKey, card.key)), tickId(laneKey, card.key)])} />)
                  : null}
              </Box>
              {card.body ? <Text>{highlight(card.body)}</Text> : <Text dimColor italic>{t('emptyNote')}</Text>}
            </Box>}
          {card.snapshot ? <Text dimColor>{'┄'.repeat(24)}</Text> : null}
          {card.snapshot
            ? (() => {
              const isOpen = opened.includes(card.key)
              const place = placeOf(card.source?.messageId)
              const short = card.snapshot.replace(/\s+/g, ' ')
              const toggle = () => update($, openSources, l => (l.includes(card.key) ? l.filter(k => k !== card.key) : [...l, card.key]))
              return (
                <Box flexDirection="column">
                  <Button key={`srcline-${card.key}`} plain dimColor
                    label={`${t('source')} ${isOpen ? '▾' : '▸'} “${isOpen ? '' : short.slice(0, 40) + (short.length > 40 ? '…' : '')}”${place ? ' · ' + place : ''}`}
                    onPress={toggle} />
                  {isOpen ? <Box paddingLeft={2}><Text dimColor>{card.snapshot}</Text></Box> : null}
                </Box>
              )
            })()
            : null}
          {isEditing && ed?.mode === 'editor'
            ? <Box flexDirection="column">
              <Text dimColor>{inApp(ed.path) ? t('syncApp') : t('syncText')}</Text>
              <Button key={`editor-close-${card.key}`} variant="primary" label={t('finishEditing')} onPress={finishEditor} />
              <Button key={`editor-discard-${card.key}`} plain label={t('discardUnsavedChanges')} onPress={discardEditor} />
            </Box>
            : null}
          {editable && !isEditing
            ? <Box gap={1} flexWrap="wrap">
              <Button key={`pin-${card.key}`} plain label={isPinned ? t('unpin') : t('pin')} onPress={() => togglePin(card.key)} />
              <Button key={`edit-${laneKey}-${card.key}`} plain label={t('edit')}
                onPress={() => (card.body.includes('\n')
                  ? openEditor(laneKey, card.key, card.body, 'editor')
                  : setEditorState($, { lane: laneKey, key: card.key, expected: vers[laneKey], mode: 'inline', path: '', synced: '' }))} />
              <Button key={`editor-${card.key}`} plain label={t('editInEditor')} onPress={() => openEditor(laneKey, card.key, card.body, 'editor')} />
              {card.source ? <Button key={`src-${card.key}`} plain label={t('returnToSource')} onPress={() => openSource($, laneKey, card)} /> : null}
              {confirming === card.key
                ? <Box gap={1}>
                  <Button key={`del-yes-${card.key}`} variant="primary" label={t('confirmDelete')} onPress={() => remove(laneKey, card.key)} />
                  <Button key={`del-no-${card.key}`} plain label={t('cancel')} onPress={() => update($, confirm, () => '')} />
                </Box>
                : <Button key={`del-${card.key}`} plain label={t('delete')} onPress={() => update($, confirm, () => card.key)} />}
            </Box>
            : null}
          {isEditing && ed?.mode === 'inline'
            ? <Button key={`edit-cancel-${card.key}`} plain label={t('cancel')} onPress={() => setEditorState($, null)} />
            : null}
        </Box>
      )
    }

    const ordered = (list: NotesCard[]) => {
      const sorted = order === 'newest' ? [...list].reverse() : [...list]
      return [...sorted.filter(c => pinned.includes(c.key)), ...sorted.filter(c => !pinned.includes(c.key))]
    }

    const conflictBanner = clash
      ? <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text>{clash.action === 'edit' ? t('conflictEdit') : t('conflictDelete')}</Text>
        {clash.action === 'edit' ? <Text dimColor>{clash.body}</Text> : null}
        <Box gap={1}>
          <Button key="clash-latest" label={t('loadLatest')} onPress={async () => {
            await update($, conflict, () => null)
            await setEditorState($, null)
            await loadCards($, v)
          }} />
          {clash.action === 'edit'
            ? <Button key="clash-overwrite" variant="primary" label={t('overwrite')}
              onPress={() => applyEdit(clash.lane, clash.key, clash.body, vers[clash.lane], true)} />
            : null}
          <Button key="clash-cancel" plain label={t('cancel')} onPress={() => update($, conflict, () => null)} />
        </Box>
      </Box>
      : null

    const renderCarry = (c: NotesCarry) => {
      const name = (k: string) => laneLabel(k)
      const laneLine = (k: string) => (c.lanes[k].skipped > 0
        ? t('carryLaneSkipped', { lane: name(k), n: c.lanes[k].offered, skipped: c.lanes[k].skipped })
        : t('carryLane', { lane: name(k), n: c.lanes[k].offered }))
      const offeredLanes = LANE_KEYS.filter((k: string) => c.lanes[k].offered > 0 || c.lanes[k].skipped > 0)
      const setC = (fn: (cur: NotesCarry) => NotesCarry) => update($, carry, cur => (cur ? fn(cur) : cur))
      const outcomeText = (r: any) => {
        const key = r.outcome === 'handled' ? 'carryOutcomeHandled' : r.outcome === 'skipped' ? 'carryOutcomeSkipped' : r.outcome === 'merged' ? 'carryOutcomeMerged' : r.outcome === 'replaced' ? 'carryOutcomeReplaced' : r.outcome === 'kept' ? 'carryOutcomeKept' : 'carryOutcomeCopied'
        return t(key, { lane: name(r.lane), n: r.carried }) + (r.skipped > 0 ? t('carrySkippedNote', { n: r.skipped }) : '')
      }
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} gap={1}>
          {c.step === 'done'
            ? <Box flexDirection="column">
              <Text bold color="cyan">{t('carryDone')}</Text>
              {(c.result ?? []).map(r => <Text>{outcomeText(r)}</Text>)}
              <Button key="carry-ok" variant="primary" label={t('ok')} onPress={() => update($, carry, () => null)} />
            </Box>
            : <Box flexDirection="column" gap={1}>
              <Text bold color="cyan">{c.resume ? t('carryResume') : t('carryQuestion', { n: c.total })}</Text>
              {c.step === 'ask'
                ? <Box flexDirection="column">
                  {offeredLanes.map((k: string) => <Text dimColor>{laneLine(k)}</Text>)}
                  <Box gap={1} flexWrap="wrap">
                    <Button key="carry-all" variant="primary" label={t('carryAll')} onPress={() => applyCarry($, v, c, 'all', LANE_KEYS.filter((k: string) => c.lanes[k].offered > 0))} />
                    <Button key="carry-some" plain label={t('carrySome')} onPress={() => setC(cur => ({ ...cur, step: 'some' }))} />
                    <Button key="carry-none" plain label={t('carryNone')} onPress={() => decideNone($, v, c)} />
                  </Box>
                </Box>
                : null}
              {c.step === 'some'
                ? <Box flexDirection="column">
                  {offeredLanes.filter((k: string) => c.lanes[k].offered > 0).map((k: string) => (
                    <Button key={`carry-lane-${k}`} {...(c.selected.includes(k) ? { variant: 'primary' } : { plain: true })}
                      label={`${c.selected.includes(k) ? '☑' : '☐'} ${laneLine(k)}`}
                      onPress={() => setC(cur => ({ ...cur, selected: cur.selected.includes(k) ? cur.selected.filter(x => x !== k) : [...cur.selected, k] }))} />
                  ))}
                  <Box gap={1}>
                    <Button key="carry-some-ok" variant="primary" label={t('carryConfirm')} onPress={() => (c.selected.length > 0 ? applyCarry($, v, c, 'some', c.selected) : decideNone($, v, c))} />
                    <Button key="carry-some-back" plain label={t('cancel')} onPress={() => setC(cur => ({ ...cur, step: 'ask' }))} />
                  </Box>
                </Box>
                : null}
              {c.step === 'ambiguous'
                ? <Box flexDirection="column" gap={1}>
                  {(c.ambiguous ?? []).map(k => (
                    <Box flexDirection="column">
                      <Text>{t('carryAmbiguous', { lane: name(k) })}</Text>
                      <Box gap={1} flexWrap="wrap">
                        <Button key={`carry-again-${k}`} variant="primary" label={t('carryBringAgain')} onPress={() => bringAmbiguousAgain($, v, c, k)} />
                        <Button key={`carry-skip-${k}`} plain label={t('carrySkip')} onPress={() => skipAmbiguousLane($, v, c, k)} />
                      </Box>
                    </Box>
                  ))}
                </Box>
                : null}
              {c.step === 'conflict'
                ? <Box flexDirection="column" gap={1}>
                  {c.selected.filter(k => c.lanes[k].occupied && c.lanes[k].offered > 0).map(k => (
                    <Box flexDirection="column">
                      <Text>{t('carryConflict', { lane: name(k) })}</Text>
                      <Box gap={1} flexWrap="wrap">
                        {(['merge', 'keep', 'replace'] as const).map(mode => (
                          <Button key={`carry-${k}-${mode}`} {...(c.modes[k] === mode ? { variant: 'primary' } : { plain: true })}
                            label={t(mode === 'merge' ? 'carryMerge' : mode === 'keep' ? 'carryKeep' : 'carryReplace')}
                            onPress={() => setC(cur => ({ ...cur, modes: { ...cur.modes, [k]: mode } }))} />
                        ))}
                      </Box>
                    </Box>
                  ))}
                  <Box gap={1}>
                    <Button key="carry-conflict-ok" variant="primary" label={t('carryConfirm')} onPress={() => applyCarry($, v, c, c.choice, c.selected)} />
                    <Button key="carry-conflict-back" plain label={t('cancel')} onPress={() => setC(cur => ({ ...cur, step: 'ask', modes: {} }))} />
                  </Box>
                </Box>
                : null}
            </Box>}
          {c.error ? <Text color="red">{c.error}</Text> : null}
        </Box>
      )
    }

    const header = (
      <Box justifyContent="space-between">
        <Text bold>{t('title')}</Text>
        <Box gap={1}>
          <Button key="hdr-search" plain label={`⌕ ${t('search')}`} onPress={() => update($, search, cur => (cur === null ? '' : null))} />
          <Button key="hdr-refresh" plain label={`↻ ${t('refresh')}`} onPress={async () => { await loadCards($, v); await say($, t('refreshed')) }} />
          <Button key="hdr-lang" plain label={t('langSwitch')} onPress={async () => {
            const next = langNow === 'zh' ? 'en' : 'zh'
            await $.store.set('locale', next)
            await useLanguage($, next)
          }} />
          <Button key="hdr-help" plain label={t('help')} onPress={() => update($, help, cur => !cur)} />
        </Box>
      </Box>
    )


    // ---- help -------------------------------------------------------------
    if (showHelp) {
      return (
        <Box flexDirection="column" gap={1}>
          <Box justifyContent="space-between">
            <Text bold>{t('helpTitle')}</Text>
            <Button key="help-back" variant="primary" label={t('backToNotes')} onPress={() => update($, help, () => false)} />
          </Box>
          {['helpBody', 'helpLane1', 'helpLane2', 'helpLane3', 'helpLane4', 'helpWrite', 'helpQuote', 'helpSource',
            'helpReference', 'helpAgent', 'helpBranches', 'helpOther', 'helpPane', 'helpLanguage'].map(k => <Text>{t(k)}</Text>)}
          <Button key="help-back-2" plain label={t('backToNotes')} onPress={() => update($, help, () => false)} />
        </Box>
      )
    }

    // ---- return to source -------------------------------------------------
    // The app cannot be scrolled to a message, so the pane is where you come
    // back (laid out as in the Codex release): your note, the quote, then the
    // quoted turn with every match highlighted between its neighbours; more
    // turns load on demand, without limit.
    if (back) {
      const close = async () => { await update($, reentry, () => null); await update($, spotlight, () => null) }
      const turns = back.foreign ? otherTurns : toTurns(cache?.blocks ?? [])
      const noteCard = ((await read($, cards))[back.lane] ?? []).find((c: NotesCard) => c.key === back.key)
      const from = Math.max(0, back.turn - back.before)
      const to = Math.min(turns.length - 1, back.turn + back.after)
      const sourceBlock = turns[back.turn]?.blocks?.find((block: Block) => block.uuid === back.source.messageId)
      const foreignNotLoaded = foreignSourceNeedsReload(back, sourceBlock)
      const runLine = (line: any[]) => <Text>{line.map((run: any) => (run.mark ? <Text backgroundColor="yellow" color="black">{run.text}</Text> : run.text))}</Text>
      const who = (role: string) => (role === 'user' ? t('you') : t('claude'))
      const label = (i: number) => (i === back.turn ? t('quotedTurnLabel')
        : i === back.turn - 1 ? t('previousTurnLabel') : i === back.turn + 1 ? t('nextTurnLabel')
          : i < back.turn ? t('earlierTurnLabel') : t('laterTurnLabel'))
      const renderTurn = (turn: any) => {
        const quoted = turn.index === back.turn
        return (
          <Box key={`src-turn-${turn.index}`} flexDirection="column" borderStyle="round"
            borderColor={quoted ? 'magenta' : 'gray'} paddingX={1}>
            <Text bold dimColor={!quoted}>{`${label(turn.index)} · #${turn.index + 1} · ${when(turn.at)}`}</Text>
            {turn.blocks.map((b: Block) => {
              const isSource = b.uuid === back.source.messageId
              return (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>{who(b.role)}</Text>
                  {isSource
                    ? <Box flexDirection="column" paddingLeft={1}>{highlightRuns(b.text, back.status === 'exact' ? back.snapshot : '').lines.map(runLine)}</Box>
                    : <Box paddingLeft={1}><Markdown text={b.text} /></Box>}
                </Box>
              )
            })}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" gap={1}>
          <Box justifyContent="space-between">
            <Text bold>{`${t('returnToSource')} · ${laneLabel(back.lane)}`}</Text>
            <Button key="src-back" variant="primary" label={t('backToNotes')} onPress={close} />
          </Box>
          {banner}
          <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            <Text dimColor>{t('yourNote')}</Text>
            {noteCard?.body ? <Text>{noteCard.body}</Text> : <Text dimColor italic>{t('emptyNote')}</Text>}
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
            <Text dimColor>{t('quotedSourceLabel')}</Text>
            <Text>{back.snapshot}</Text>
            {back.status === 'exact' && sourceBlock ? <Text color="green">{t('statusExact', { n: highlightRuns(sourceBlock.text, back.snapshot).matches })}</Text> : null}
            {back.status === 'nonexact' && sourceBlock ? <Text color="yellow">{t('statusNonExact')}</Text> : null}
            {foreignNotLoaded ? <Text color="yellow">{t('sourceNotLoaded')}</Text> : null}
            {back.status === 'unavailable' && !foreignNotLoaded ? <Text color="red">{t('sourceUnavailable')}</Text> : null}
          </Box>
          {back.status === 'ask' || foreignNotLoaded
            ? <Box flexDirection="column" gap={1}>
              <Text>{foreignNotLoaded ? t('sourceNotLoaded') : t('otherConversation')}</Text>
              <Button key="src-other" variant="primary" label={t('showSource')} onPress={async () => {
                if (noteCard) await openSource($, back.lane, noteCard, true)
              }} />
            </Box>
            : null}
          {back.turn >= 0 && from > 0
            ? <Button key="src-earlier" plain label={t('showEarlier')} onPress={() => update($, reentry, cur => (cur ? { ...cur, before: cur.before + 1 } : cur))} />
            : null}
          {back.turn >= 0 && sourceBlock ? turns.slice(from, to + 1).map(renderTurn) : null}
          {back.turn >= 0 && to < turns.length - 1
            ? <Button key="src-later" plain label={t('showLater')} onPress={() => update($, reentry, cur => (cur ? { ...cur, after: cur.after + 1 } : cur))} />
            : null}
          {back.turn >= 0 && !back.foreign ? <Text dimColor>{t('alsoMarked')}</Text> : null}
          {back.foreign && back.link
            ? <Button key="src-open-original" plain label={t('openOriginal')} onPress={() => openLink($, back.link as string)} />
            : null}
        </Box>
      )
    }

    // ---- find in conversation -------------------------------------------
    // Browse or search the conversation, open a turn, and pick the quote by
    // sentence (first and last); the pane cannot select text, and the quote
    // stays within one message.
    if (mir) {
      const turns = toTurns(cache?.blocks ?? [])
      const setMir = (fn: (m: any) => any) => update($, mirror, cur => (cur ? fn(cur) : cur))
      const quoted = new Set(LANE_KEYS.flatMap((k: string) => (all[k] ?? []).map((c: NotesCard) => c.source?.messageId).filter(Boolean)))
      const who = (role: string) => (role === 'user' ? t('you') : t('claude'))
      const header = (
        <Box justifyContent="space-between">
          <Text bold>{t('findTitle')}</Text>
          <Button key="mir-back" variant="primary" label={t('backToNotes')} onPress={() => update($, mirror, () => null)} />
        </Box>
      )

      if (mir.focus >= 0 && turns[mir.focus]) {
        const from = Math.max(0, mir.focus - mir.before)
        const to = Math.min(turns.length - 1, mir.focus + mir.after)
        const sel = mir.sel
        const pick = (b: Block, i: number) => setMir(m => {
          if (!m.sel || m.sel.uuid !== b.uuid) return { ...m, sel: { uuid: b.uuid, a: i, b: -1 } }
          if (m.sel.b < 0) return { ...m, sel: { ...m.sel, b: i } }
          return { ...m, sel: { uuid: b.uuid, a: i, b: -1 } }
        })
        const selectable = (b: Block) => {
          const { list } = sentences(b.text)
          const q = mir.query.trim().toLowerCase()
          const lo = sel && sel.uuid === b.uuid ? Math.min(sel.a, sel.b < 0 ? sel.a : sel.b) : -1
          const hi = sel && sel.uuid === b.uuid ? Math.max(sel.a, sel.b < 0 ? sel.a : sel.b) : -1
          return (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {list.map((sn: any, i: number) => (
                <Button key={`sn-${b.uuid}-${i}`} {...(i >= lo && i <= hi ? { variant: 'primary' } : { plain: true })}
                  label={`${q.length >= 2 && sn.text.toLowerCase().includes(q) ? '▶ ' : ''}${sn.text}`}
                  onPress={() => pick(b, i)} />
              ))}
            </Box>
          )
        }
        // A copied text being placed: the message drawn with every match
        // marked, and where it occurs, a button to quote it from there.
        const pasted = (b: Block) => {
          const { lines: rows, matches } = highlightRuns(b.text, mir.paste as string)
          return (
            <Box flexDirection="column">
              {rows.map((line: any[]) => <Text>{line.map((run: any) => (run.mark ? <Text backgroundColor="yellow" color="black">{run.text}</Text> : run.text))}</Text>)}
              {matches > 0
                ? <Button key={`ph-quote-${b.uuid}`} variant="primary" label={t('quoteHereButton')} onPress={() => attachQuote($, mir.paste as string, b)} />
                : null}
            </Box>
          )
        }
        const renderTurn = (turn: any) => {
          const focus = turn.index === mir.focus
          return (
            <Box key={`f-turn-${turn.index}`} flexDirection="column" borderStyle="round" borderColor={focus ? 'magenta' : 'gray'} paddingX={1}>
              <Text bold dimColor={!focus}>{`#${turn.index + 1} · ${when(turn.at)}`}</Text>
              {turn.blocks.map((b: Block) => (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>{who(b.role)}</Text>
                  {mir.paste ? pasted(b) : selectable(b)}
                </Box>
              ))}
            </Box>
          )
        }
        const selBlock = sel ? (cache?.blocks ?? []).find((b: Block) => b.uuid === sel.uuid) : undefined
        const selText = sel && selBlock ? sentenceRange(selBlock.text, sel.a, sel.b < 0 ? sel.a : sel.b) : ''
        return (
          <Box flexDirection="column" gap={1}>
            {header}
            {banner}
            <Button key="f-list" plain label={t('backToList')} onPress={() => setMir(m => ({ ...m, focus: -1, sel: null }))} />
            {mir.paste ? null : <Text dimColor>{t('pickHint')}</Text>}
            {from > 0 ? <Button key="f-earlier" plain label={t('showEarlier')} onPress={() => setMir(m => ({ ...m, before: m.before + 1 }))} /> : null}
            {turns.slice(from, to + 1).map(renderTurn)}
            {to < turns.length - 1 ? <Button key="f-later" plain label={t('showLater')} onPress={() => setMir(m => ({ ...m, after: m.after + 1 }))} /> : null}
            {selText
              ? <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
                <Text>{selText.length > 300 ? `${selText.slice(0, 300)}…` : selText}</Text>
                <Box gap={1}>
                  <Button key="f-quote" variant="primary" label={t('quoteSelected')} onPress={async () => {
                    if (!selBlock || locate(selBlock.text, selText).ranges.length === 0) { await say($, t('notInMessage'), true); return }
                    await update($, candidates, () => null)
                    await update($, quote, () => toQuote(selText, selBlock))
                    await update($, mirror, () => null)
                  }} />
                  <Button key="f-clear" plain label={t('clearSelection')} onPress={() => setMir(m => ({ ...m, sel: null }))} />
                </Box>
              </Box>
              : null}
          </Box>
        )
      }

      const open = (i: number) => setMir(m => ({ ...m, focus: i, before: 0, after: 0, sel: null }))
      if (mir.paste) {
        const found = pasteHits(turns, mir.paste)
        const short = mir.paste.replace(/\s+/g, ' ')
        return (
          <Box flexDirection="column" gap={1}>
            {header}
            {banner}
            <Box borderStyle="round" borderColor="magenta" paddingX={1}><Text>{short.length > 120 ? `${short.slice(0, 120)}…` : short}</Text></Box>
            <Text bold>{t('pasteFound', { n: found.length })}</Text>
            {[...found].reverse().map((hit: any, i: number) => (
              <Box key={`ph-${i}`} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                <Button key={`ph-btn-${i}`} plain label={`#${hit.turn + 1} · ${when(hit.at)} · ${who(hit.role)}${hit.matches > 1 ? ` · ×${hit.matches}` : ''}  ▸`} onPress={() => open(hit.turn)} />
                {hit.prompt ? <Text dimColor>{t('youAsked', { text: hit.prompt })}</Text> : null}
                <Text>{`…${hit.before}`}<Text backgroundColor="yellow" color="black">{hit.match}</Text>{`${hit.after}…`}</Text>
              </Box>
            ))}
          </Box>
        )
      }
      const hits = searchTurns(turns, mir.query)
      const first = Math.max(0, turns.length - mir.shown)
      const outline = (turn: any) => {
        const sum = turnSummary(turn, 120)
        const marked = turn.blocks.some((b: Block) => quoted.has(b.uuid))
        return (
          <Box key={`o-${turn.index}`} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            <Button key={`o-btn-${turn.index}`} plain label={`#${turn.index + 1} · ${when(turn.at)}${marked ? ' · 📌' : ''}  ▸`} onPress={() => open(turn.index)} />
            <Text>{`${t('you')}: ${sum.prompt}`}</Text>
            {sum.answer ? <Text dimColor>{`${t('claude')}: ${sum.answer}`}</Text> : null}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {banner}
          <Text dimColor>{t('findHow')}</Text>
          <Input key="mir-search" placeholder={t('searchConversation')} submitLabel={t('search')}
            onInput={(value: string) => setMir(m => ({ ...m, query: value }))}
            onSubmit={(value: string) => setMir(m => ({ ...m, query: value }))} />
          {mir.query.trim().length >= 2
            ? <Box flexDirection="column" gap={1}>
              <Text bold>{t('searchHits', { n: hits.length })}</Text>
              {hits.map((hit: any, i: number) => (
                <Box key={`hit-${i}`} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                  <Button key={`hit-btn-${i}`} plain label={`#${hit.turn + 1} · ${when(hit.at)} · ${who(hit.role)}  ▸`} onPress={() => open(hit.turn)} />
                  {hit.prompt ? <Text dimColor>{t('youAsked', { text: hit.prompt })}</Text> : null}
                  <Text>{`…${hit.before}`}<Text backgroundColor="yellow" color="black">{hit.match}</Text>{`${hit.after}…`}</Text>
                </Box>
              ))}
            </Box>
            : <Box flexDirection="column" gap={1}>
              <Text bold>{t('recentTurns')}</Text>
              {turns.length === 0 ? <Text dimColor>{t('noTurns')}</Text> : null}
              {first > 0 ? <Button key="mir-more" plain label={t('loadEarlier')} onPress={() => setMir(m => ({ ...m, shown: m.shown + 20 }))} /> : null}
              {turns.slice(first).map(outline)}
            </Box>}
        </Box>
      )
    }

    if (query !== null) {
      const q = query.trim().toLowerCase()
      const groups = lanes.map((l: any) => ({
        key: l.key,
        hits: q ? ordered(all[l.key] ?? []).filter(c => `${c.body}\n${c.snapshot ?? ''}`.toLowerCase().includes(q)) : [],
      })).filter((g: any) => g.hits.length > 0)
      const total = groups.reduce((sum: number, g: any) => sum + g.hits.length, 0)
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {banner}
          {conflictBanner}
          <Box gap={1}>
            <Input key="search-box" placeholder={t('searchPlaceholder')} autoFocus submitLabel={t('search')}
              onInput={(value: string) => update($, search, () => value)}
              onSubmit={(value: string) => update($, search, () => value)} />
            <Button key="search-close" plain label={t('closeSearch')} onPress={() => update($, search, () => null)} />
          </Box>
          <Text bold>{t('searchResults', { n: total })}</Text>
          {groups.map((g: any) => g.hits.map((c: NotesCard) => renderCard(g.key, c, true)))}
        </Box>
      )
    }

    const list = ordered(all[current] ?? [])

    const laneOptions = lanes.map((l: any) => ({ value: l.key, label: l.label }))
    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {banner}
        {conflictBanner}
        {fork ? renderCarry(fork) : null}
        <Box flexWrap="wrap" gap={1}>
          {lanes.map((l: any) => (
            <Button key={`lane-${l.key}`} variant={l.key === current ? 'primary' : 'secondary'}
              label={`${l.label} · ${(all[l.key] ?? []).length}`}
              onPress={() => update($, lane, () => l.key)} />
          ))}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
          <Box gap={1} alignItems="center">
            <Text bold color="blue">{t('newNote')}</Text>
            <Select key="compose-lane" options={laneOptions} value={current} onSelect={(value: string) => update($, lane, () => value)} />
          </Box>
          {ed?.mode === 'new'
            ? <Box flexDirection="column">
              <Text dimColor>{inApp(ed.path) ? t('draftApp') : t('draftText')}</Text>
              <Box paddingLeft={2}><Text>{(ed.observed ?? ed.synced) ? ((ed.observed ?? ed.synced).length > 240 ? `${(ed.observed ?? ed.synced).slice(0, 240)}…` : (ed.observed ?? ed.synced)) : t('draftEmpty')}</Text></Box>
              <Box gap={1}>
                <Button key="draft-save" variant="primary" label={t('save')} onPress={async () => {
                  try {
                    let draft = ed.observed ?? ed.synced ?? ''
                    if (ed.path && await $.fs.exists(ed.path)) draft = bodyFromEditor(ed, await $.fs.read(ed.path))
                    await save(draft, ed.lane, () => finishSavedEditor(ed))
                  } catch (err) {
                    await say($, t('writeFailed', { detail: String(err).slice(0, 120) }), true)
                  }
                }} />
                <Button key="draft-discard" plain label={t('discardDraft')} onPress={discardEditor} />
              </Box>
            </Box>
            : <Box gap={1} flexWrap="wrap" alignItems="center">
              <Input key={`compose-${n}`} placeholder={q ? t('commentPlaceholder') : t('placeholder')} submitLabel={t('save')} onSubmit={(value: string) => save(value)} />
              <Button key="new-in-editor" plain label={t('newInEditor')} onPress={() => openEditor(current, '', '', 'new')} />
            </Box>}
          <Box flexDirection="column" marginTop={1}>
            <Box gap={2} flexWrap="wrap">
              <Button key="quote-copied" plain label={t('quoteCopied')} onPress={() => quoteClipboard($)} />
              <Button key="quote-mirror" plain label={t('quoteFromConversation')} onPress={async () => {
                await update($, mirror, () => ({ shown: 10, expanded: [], query: '', focus: -1, before: 0, after: 0, sel: null }))
                await loadTranscript($)
                await update($, tick, k => k + 1)
              }} />
            </Box>
            {again
              ? <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
                <Text>{t('reuseAsk', { text: again.replace(/\s+/g, ' ').slice(0, 60) + (again.length > 60 ? '…' : '') })}</Text>
                <Box gap={1}>
                  <Button key="reuse-yes" variant="primary" label={t('reuseYes')} onPress={() => quoteClipboard($, true)} />
                  <Button key="reuse-no" plain label={t('cancel')} onPress={() => update($, reuse, () => null)} />
                </Box>
              </Box>
              : null}
            {q
              ? <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
                <Text color="magenta">{[t('quoteAttached'), roleLabel(q.role), placeOf(q.source.messageId)].filter(Boolean).join(' · ')}</Text>
                <Text>{q.snapshot.length > 300 ? `${q.snapshot.slice(0, 300)}…` : q.snapshot}</Text>
                <Button key="quote-remove" plain dimColor label={t('removeQuote')} onPress={() => update($, quote, () => null)} />
              </Box>
              : null}
            {cands
              ? <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
                <Text color="magenta">{t('quoteFound', { n: cands.list.length })}</Text>
                {cands.list.map((c: NotesCandidate) => (
                  <Button key={`cand-${c.uuid}`} plain label={`${placeOf(c.uuid) || when(c.at)} · ${roleLabel(c.role)} · ${c.excerpt}${c.matches > 1 ? ` (×${c.matches})` : ''}`}
                    onPress={async () => {
                      await update($, candidates, () => null)
                      await update($, quote, () => ({ snapshot: cands.snapshot, source: { sessionId: c.sessionId, messageId: c.uuid }, role: c.role }))
                    }} />
                ))}
                <Button key="cand-cancel" plain dimColor label={t('cancel')} onPress={() => update($, candidates, () => null)} />
              </Box>
              : null}
          </Box>
        </Box>
        {held.length > 0
          ? <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
            <Box justifyContent="space-between">
              <Text bold color="magenta">{t('trayTitle', { n: held.length })}</Text>
              <Button key="tray-clear" plain dimColor label={t('removeAllTicks')} onPress={() => setTicks($, v, () => [])} />
            </Box>
            {held.map(id => {
              const [l, k] = splitTick(id)
              const c = (all[l] ?? []).find(x => x.key === k)
              return (
                <Box justifyContent="space-between">
                  <Text>{`${laneLabel(l)} · ${c ? excerpt(c, 40) || t('emptyNote') : '…'}`}</Text>
                  <Button key={`tray-rm-${id}`} plain dimColor label={t('removeTick')} onPress={() => setTicks($, v, cur => cur.filter(x => x !== id))} />
                </Box>
              )
            })}
          </Box>
          : null}
        <Box justifyContent="space-between">
          <Text bold>{t('savedNotes', { n: list.length })}</Text>
          <Box gap={1}>
            <Button key="sort-newest" plain dimColor={order !== 'newest'} label={t('newest')} onPress={() => update($, sort, () => 'newest')} />
            <Button key="sort-oldest" plain dimColor={order !== 'oldest'} label={t('oldest')} onPress={() => update($, sort, () => 'oldest')} />
          </Box>
        </Box>
        {list.length === 0 ? <Text dimColor>{t('empty')}</Text> : null}
        <Box flexDirection="column" gap={1}>
          {list.map(card => renderCard(current, card, false))}
        </Box>
        {list.length > 2
          ? <Button key="list-top" plain dimColor label={t('backToTop')} onPress={() => $.ui.scroll({ in: PANE, to: 'start' })} />
          : null}
        <Box gap={1} flexWrap="wrap">
          <Text dimColor>{t('boundPath', { path: root })}</Text>
          <Button key="change-location" plain dimColor label={t('changeLocation')} onPress={async () => {
            await update($, view, cur => (cur ? { ...cur, root: null, setup: null } : cur))
            await startSetup($, { ...v, root: null, setup: null }, root)
            await update($, view, cur => (cur?.setup ? { ...cur, setup: { ...cur.setup, previous: root } } : cur))
          }} />
        </Box>
      </Box>
    )
}
