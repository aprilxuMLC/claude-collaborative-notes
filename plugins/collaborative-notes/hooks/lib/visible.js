// Markdown source -> the text a reader sees, with a map back to source
// positions; used to verify a copied selection S against a message.
// Markdown source -> visible text, with map[i] = source index of visible char i.
export const project = (src) => {
  let out = ''
  const map = []
  const push = (c, i) => { out += c; map.push(i) }
  const lines = src.split('\n')
  let base = 0
  let inFence = false
  lines.forEach((line, li) => {
    if (li > 0) push('\n', base - 1)
    const fence = /^\s*(```|~~~)/.test(line)
    if (fence) { inFence = !inFence; base += line.length + 1; return }
    let i = 0
    if (!inFence) {
      const lead = line.match(/^([ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)*)/)
      i = lead ? lead[0].length : 0
      if (/^\s*\|?\s*:?-{3,}/.test(line)) { base += line.length + 1; return }
    }
    const hiddenDelimiters = emphasisDelimiters(line, i)
    while (i < line.length) {
      const c = line[i]
      if (inFence) { push(c, base + i); i++; continue }
      if (c === '`' && !escapedAt(line, i)) {
        let runEnd = i + 1
        while (line[runEnd] === '`') runEnd++
        const length = runEnd - i
        let next = runEnd
        let close = -1
        while (next < line.length) {
          const tick = line.indexOf('`', next)
          if (tick < 0) break
          let tickEnd = tick + 1
          while (line[tickEnd] === '`') tickEnd++
          if (tickEnd - tick === length) { close = tick; break }
          next = tickEnd
        }
        if (close >= 0) {
          let contentStart = runEnd
          let contentEnd = close
          if (line[contentStart] === ' ' && line[contentEnd - 1] === ' ' && /[^ ]/.test(line.slice(contentStart, contentEnd))) {
            contentStart += 1
            contentEnd -= 1
          }
          for (let at = contentStart; at < contentEnd; at++) push(line[at], base + at)
          i = close + length
        } else {
          for (; i < runEnd; i++) push(line[i], base + i)
        }
        continue
      }
      if (hiddenDelimiters.has(i)) { i++; continue }
      if (c === '|') { push(' ', base + i); i++; continue }
      if (c === '[') {
        const m = line.slice(i).match(/^\[([^\]]*)\]\([^)]*\)/)
        if (m) {
          for (let k = 0; k < m[1].length; k++) if (!hiddenDelimiters.has(i + 1 + k)) push(m[1][k], base + i + 1 + k)
          i += m[0].length
          continue
        }
      }
      if (c === '\\' && i + 1 < line.length) { push(line[i + 1], base + i + 1); i += 2; continue }
      push(c, base + i); i++
    }
    base += line.length + 1
  })
  return { text: out, map }
}

const whitespace = (value) => value === undefined || /\s/u.test(value)
const punctuation = (value) => value !== undefined && /[\p{P}\p{S}]/u.test(value)

function opaqueCode(line) {
  const opaque = new Set()
  for (let i = 0; i < line.length;) {
    if (line[i] !== '`' || escapedAt(line, i)) { i++; continue }
    let end = i + 1
    while (line[end] === '`') end++
    const length = end - i
    let next = end
    let close = -1
    while (next < line.length) {
      const tick = line.indexOf('`', next)
      if (tick < 0) break
      let tickEnd = tick + 1
      while (line[tickEnd] === '`') tickEnd++
      if (tickEnd - tick === length) { close = tick; break }
      next = tickEnd
    }
    if (close >= 0) {
      for (let at = i; at < close + length; at++) opaque.add(at)
      i = close + length
    } else i = end
  }
  return opaque
}

function escapedAt(line, at) {
  let slashes = 0
  for (let i = at - 1; i >= 0 && line[i] === '\\'; i--) slashes++
  return slashes % 2 === 1
}

// CommonMark 0.31.2 delimiter processing. Runs can be consumed partially;
// unmatched delimiter characters remain in the projection.
function emphasisDelimiters(line, start) {
  const opaque = opaqueCode(line)
  // Destinations and titles are opaque inline syntax. Delimiters in a link
  // label remain eligible, but are scoped to that label so they cannot pair
  // with delimiters outside the link.
  const linkScopes = []
  const linkOpaque = new Set()
  let scopeId = 0
  for (let open = start; open < line.length; open++) {
    if (line[open] !== '[' || opaque.has(open) || escapedAt(line, open)) continue
    let close = open + 1
    while (close < line.length && (line[close] !== ']' || escapedAt(line, close))) close++
    if (close < line.length && line[close + 1] === '(') {
      let end = close + 2
      let depth = 0
      for (; end < line.length; end++) {
        if (line[end] === '(' && !escapedAt(line, end)) depth++
        else if (line[end] === ')' && !escapedAt(line, end)) {
          if (depth === 0) break
          depth--
        }
      }
      if (end < line.length) {
        const id = ++scopeId
        linkScopes.push({ open, close, end, id })
        for (let at = close + 1; at <= end; at++) linkOpaque.add(at)
        open = close
      }
    }
  }
  const scopeAt = (at) => {
    for (let i = linkScopes.length - 1; i >= 0; i--) {
      const scope = linkScopes[i]
      if (at > scope.open && at < scope.close) return scope.id
    }
    return 0
  }
  const runs = []
  for (let at = start; at < line.length;) {
    const marker = line[at]
    if ((marker !== '*' && marker !== '_') || opaque.has(at) || linkOpaque.has(at) || escapedAt(line, at)) { at++; continue }
    let end = at + 1
    while (line[end] === marker && !opaque.has(end) && !linkOpaque.has(end) && !escapedAt(line, end)) end++
    const beforeAt = at > 0 && /[\uDC00-\uDFFF]/.test(line[at - 1]) ? at - 2 : at - 1
    const before = beforeAt >= 0 ? String.fromCodePoint(line.codePointAt(beforeAt)) : undefined
    const after = end < line.length ? String.fromCodePoint(line.codePointAt(end)) : undefined
    const left = !whitespace(after) && (!punctuation(after) || whitespace(before) || punctuation(before))
    const right = !whitespace(before) && (!punctuation(before) || whitespace(after) || punctuation(after))
    const canOpen = marker === '_' ? left && (!right || punctuation(before)) : left
    const canClose = marker === '_' ? right && (!left || punctuation(after)) : right
    runs.push({ at, end, length: end - at, remaining: end - at, marker, canOpen, canClose, canBoth: canOpen && canClose, scope: scopeAt(at) })
    at = end
  }

  const bottoms = new Map()
  const hidden = new Set()
  const inactive = new Set()
  const keyFor = (run) => `${run.scope}:${run.marker}:${run.canOpen ? 1 : 0}:${run.remaining % 3}`
  for (let closeIndex = 0; closeIndex < runs.length; closeIndex++) {
    const closer = runs[closeIndex]
    if (!closer.canClose) continue
    while (closer.remaining > 0) {
      const key = keyFor(closer)
      let openerIndex = null
      const bottom = bottoms.get(key) ?? -1
      for (let i = closeIndex - 1; i > bottom; i--) {
        const candidate = runs[i]
        if (inactive.has(i) || candidate.marker !== closer.marker || candidate.scope !== closer.scope || !candidate.canOpen || candidate.remaining === 0) continue
        const sum = candidate.remaining + closer.remaining
        const multipleOfThreeRule = (candidate.canBoth || closer.canBoth) && sum % 3 === 0
          && (candidate.remaining % 3 !== 0 || closer.remaining % 3 !== 0)
        if (multipleOfThreeRule) continue
        openerIndex = i
        break
      }
      if (openerIndex === null) {
        bottoms.set(key, closeIndex - 1)
        break
      }
      const opener = runs[openerIndex]
      const used = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1
      for (let n = 0; n < used; n++) {
        hidden.add(opener.end - 1 - n)
        hidden.add(closer.at + n)
      }
      opener.remaining -= used
      opener.end -= used
      closer.remaining -= used
      closer.at += used
      // CommonMark removes delimiter runs between a successful pair from
      // further processing, preventing crossing pairs. Their characters are
      // still literal unless an earlier match already consumed them.
      for (let i = openerIndex + 1; i < closeIndex; i++) {
        inactive.add(i)
      }
      if (opener.remaining === 0) opener.canOpen = false
      if (closer.remaining === 0) closer.canClose = false
    }
  }
  return hidden
}

// The app draws straight quotes as curly ones (it's -> it’s), so a copy has
// the curly form: compare quotes as one kind (same length, maps unchanged).
const plainQuote = (c) => (/[‘’‛′]/.test(c) ? "'" : /[“”„″]/.test(c) ? '"' : c)

// Whitespace runs -> one space. Punctuation is retained for exact matching.
// Returns the string and a map to input indices.
const squash = (s) => {
  let out = ''
  const map = []
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) { if (out.endsWith(' ')) continue; out += ' '; map.push(i) }
    else { out += plainQuote(s[i]); map.push(i) }
  }
  return { out, map }
}

// All occurrences of S in the visible text of src: ranges in visible-text indices.
export const locate = (src, s) => {
  const vis = project(src)
  const hay = squash(vis.text)
  const needle = squash(s).out.trim()
  const ranges = []
  if (!needle) return { vis, ranges }
  let at = hay.out.indexOf(needle)
  while (at >= 0) {
    ranges.push([hay.map[at], hay.map[at + needle.length - 1]])
    at = hay.out.indexOf(needle, at + 1)
  }
  return { vis, ranges }
}
