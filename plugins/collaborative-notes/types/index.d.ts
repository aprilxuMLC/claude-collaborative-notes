export type NotesCard = {
  index: number
  key: string
  kind: string
  body: string
  snapshot?: string
  source?: { sessionId: string; messageId: string }
}

export type NotesView = {
  project: string
  sessionId: string
  root: string | null
  setup: {
    candidate: string; exists: boolean; notDir: boolean; lanes: string[]; other: boolean; error: string
    browsePath: string; folders: string[]; laneNames: string[]
  } | null
}

export type NotesToast = { text: string; error: boolean; at: number }

export type NotesEditing = { lane: string; key: string; expected: string; mode: string; path: string; synced: string; observed?: string; header?: string }

export type NotesSource = { sessionId: string; messageId: string }

export type NotesQuote = { snapshot: string; source: NotesSource; role: string }

export type NotesCandidate = { uuid: string; sessionId: string; role: string; at: string; excerpt: string; matches: number }

export type NotesMirror = {
  shown: number; expanded: number[]; query: string
  focus: number; before: number; after: number; sel: { uuid: string; a: number; b: number } | null
  paste?: string
}

export type NotesReentry = {
  lane: string; key: string; snapshot: string; source: NotesSource
  status: string; turn: number; before: number; after: number; foreign: boolean
  full: boolean; open: number[]; link?: string
}

export type NotesCarryLane = { offered: number; skipped: number; occupied: boolean }
export type NotesCarryResult = { lane: string; outcome: string; carried: number; skipped: number }
export type NotesCarry = {
  parent: string
  step: 'ask' | 'some' | 'conflict' | 'ambiguous' | 'done'
  resume: boolean
  total: number
  lanes: Record<string, NotesCarryLane>
  selected: string[]
  ambiguous?: string[]
  modes: Record<string, string>
  choice: string
  result: NotesCarryResult[]
  error: string
}

export type NotesMark = { text: string; notes: string[] }

export type NotesConflict = { lane: string; key: string; action: string; body: string }

declare module 'claude-code' {
  interface PluginState {
    'collaborative-notes': {
      view: NotesView | null
      lane: string
      sort: string
      cards: Record<string, NotesCard[]>
      toast: NotesToast | null
      composer: number
      versions: Record<string, string>
      pins: string[]
      editing: NotesEditing | null
      confirm: string
      search: string | null
      conflict: NotesConflict | null
      quote: NotesQuote | null
      candidates: { snapshot: string; list: NotesCandidate[] } | null
      mirror: NotesMirror | null
      reentry: NotesReentry | null
      spotlight: { renderId: string; snapshot: string } | null
      tick: number
      transcriptPath: string
      openSources: string[]
      ticks: string[]
      marks: Record<string, NotesMark>
      lang: string
      help: boolean
      carry: NotesCarry | null
      reuse: string | null
    }
  }
}
