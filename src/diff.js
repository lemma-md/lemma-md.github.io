// A small line-level diff, enough for comparing two versions of a note.
//
// There is no build step here, so rather than vendor a diff library this is a
// compact longest-common-subsequence diff written by hand. Notes are small, but
// to stay safe on a large file with a small edit it first strips the common
// head and tail (cheap) and runs the quadratic core only on what is left. Past
// a size cap it gives up on alignment and reports a wholesale replacement.

const CAP = 4_000_000 // midA.length * midB.length beyond which we don't align

/** LCS diff of two arrays of lines → ops of { type: 'same'|'del'|'add', text }. */
function lcsDiff(a, b) {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((text) => ({ type: 'add', text }))
  if (m === 0) return a.map((text) => ({ type: 'del', text }))
  if (n * m > CAP) {
    return [...a.map((text) => ({ type: 'del', text })), ...b.map((text) => ({ type: 'add', text }))]
  }

  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: a[i] }); i++ }
    else { ops.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < n) ops.push({ type: 'del', text: a[i++] })
  while (j < m) ops.push({ type: 'add', text: b[j++] })
  return ops
}

/** Diff two whole texts by line. */
export function lineDiff(aText, bText) {
  const a = (aText ?? '').split('\n')
  const b = (bText ?? '').split('\n')

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let ea = a.length
  let eb = b.length
  while (ea > start && eb > start && a[ea - 1] === b[eb - 1]) { ea--; eb-- }

  const ops = []
  for (let k = 0; k < start; k++) ops.push({ type: 'same', text: a[k] })
  ops.push(...lcsDiff(a.slice(start, ea), b.slice(start, eb)))
  for (let k = ea; k < a.length; k++) ops.push({ type: 'same', text: a[k] })
  return ops
}

/**
 * How many lines are affected — 0 means the two texts are identical. A line
 * changed in place counts once, not as a deletion plus an addition, so a run of
 * deletions paired with additions is counted as the larger of the two. This
 * matches the number of changed rows the side-by-side view shows.
 */
export function changeCount(aText, bText) {
  if (aText === bText) return 0
  const ops = lineDiff(aText, bText)
  let count = 0
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === 'same') { i++; continue }
    let dels = 0
    let adds = 0
    while (i < ops.length && ops[i].type === 'del') { dels++; i++ }
    while (i < ops.length && ops[i].type === 'add') { adds++; i++ }
    count += Math.max(dels, adds)
  }
  return count
}

/**
 * Summarise a diff: how many lines were added, how many deleted, and how many
 * separate blocks (contiguous runs of change) they fall into.
 */
export function diffStats(ops) {
  let added = 0
  let deleted = 0
  let blocks = 0
  let inBlock = false
  for (const o of ops) {
    if (o.type === 'same') { inBlock = false; continue }
    if (o.type === 'add') added++
    else deleted++
    if (!inBlock) { blocks++; inBlock = true }
  }
  return { added, deleted, blocks }
}

// Words, runs of whitespace, and single other characters — the units a
// within-line diff highlights, so a one-word edit lights up the word, not the
// whole line. Unicode-aware, so Cyrillic and the like tokenise as words too.
const tokenize = (s) => s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) || []

/**
 * Diff two single lines at the token level, for highlighting the part that
 * actually changed. Returns the pieces of each side as { text, changed }, with
 * adjacent pieces of the same kind merged.
 */
export function inlineDiff(a, b) {
  const ops = lcsDiff(tokenize(a), tokenize(b))
  const left = []
  const right = []
  const push = (arr, text, changed) => {
    const last = arr[arr.length - 1]
    if (last && last.changed === changed) last.text += text
    else arr.push({ text, changed })
  }
  for (const op of ops) {
    if (op.type === 'same') { push(left, op.text, false); push(right, op.text, false) }
    else if (op.type === 'del') push(left, op.text, true)
    else push(right, op.text, true)
  }
  return { left, right }
}

/**
 * Turn diff ops into aligned side-by-side rows. A run of deletions followed by
 * additions is paired up line-for-line so a changed line sits opposite its
 * replacement; leftovers get a blank cell on the other side. Each row carries
 * the 1-based line number on each side (null where that side is blank).
 */
export function sideBySide(ops) {
  const rows = []
  let ln = 0
  let rn = 0
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === 'same') {
      rows.push({ kind: 'same', left: ops[i].text, right: ops[i].text, ln: ++ln, rn: ++rn })
      i++
      continue
    }
    const dels = []
    const adds = []
    while (i < ops.length && ops[i].type === 'del') dels.push(ops[i++].text)
    while (i < ops.length && ops[i].type === 'add') adds.push(ops[i++].text)
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) {
      const hasL = k < dels.length
      const hasR = k < adds.length
      rows.push({
        kind: 'change',
        left: hasL ? dels[k] : null,
        right: hasR ? adds[k] : null,
        ln: hasL ? ++ln : null,
        rn: hasR ? ++rn : null,
      })
    }
  }
  return rows
}
