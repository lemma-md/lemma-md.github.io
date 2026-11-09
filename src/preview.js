// The editor's preview, brought up to date part by part. At each pause in
// typing the whole note used to be rendered again and put in with innerHTML;
// on a 100 KB note with formulas that took about 300 ms to render and as long
// again for the browser to lay out, the window frozen meanwhile. Now the note's
// top-level blocks are rendered and kept, keyed by their source, and an edit
// renders again only the blocks it touched. The others' nodes are left where
// they are, so the browser does not lay them out again either.

import { renderRuns, hasHtml, leavesOpen } from './viewer.js'

/**
 * Make `parent`'s child nodes exactly `nodes`, in order, taking out and putting
 * in only what changed. A node that stays where it was keeps its layout;
 * putting every one back, as replaceChildren does, lays them all out again.
 */
export function patchChildren(parent, nodes) {
  const keep = new Set(nodes)
  let at = parent.firstChild
  // Nodes to go in before `at`, gathered so that a run of them goes in at once.
  let batch = null
  const flush = () => { if (batch) parent.insertBefore(batch, at); batch = null }
  const drop = () => { const next = at.nextSibling; at.remove(); at = next }
  for (const node of nodes) {
    while (at && !keep.has(at)) drop()
    if (node === at) {
      flush()
      at = at.nextSibling
    } else {
      (batch ??= document.createDocumentFragment()).append(node)
    }
  }
  flush()
  while (at) drop()
}

// Elements that hold nothing and take no closing tag.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const TAG = /<!--(?:>|->|[\s\S]*?-->)|<!--|<(\/?)([A-Za-z][\w:-]*)(?:[^>"']|"[^"]*"|'[^']*')*>/g

/**
 * About how many elements are open after the HTML written in `tokens`, block
 * or inline, given `depth` open before: a first guess at where the runs end,
 * which keeps an element left open from being asked about run by run. The
 * browser has the last word (see settle).
 */
function opened(tokens, depth) {
  for (const token of tokens) {
    if (token.type === 'html') {
      for (const m of token.raw.matchAll(TAG)) {
        // A comment left open hides the rest of the note.
        if (m[0] === '<!--') depth += 1
        else if (m[2] && !VOID.has(m[2].toLowerCase()) && !m[0].endsWith('/>')) depth += m[1] ? -1 : 1
      }
    }
    for (const inner of [token.tokens, token.items, token.header, ...(token.rows ?? [])]) {
      if (Array.isArray(inner)) depth = opened(inner, depth)
    }
  }
  return depth
}

/**
 * The note's top-level tokens in runs meant to render on their own: one token
 * each, but several when HTML opened in one is closed in a later one, as a
 * <details> written around Markdown is. Rendered apart, the first would be
 * closed early and the Markdown left outside it. An element never closed takes
 * in the rest of the note, as it does when the note is rendered whole. This
 * goes by the guess of opened(); settle() makes sure. The blank lines between
 * blocks show as nothing and are left out.
 */
function runs(tokens) {
  const out = []
  let start = -1
  let first = 0
  let open = 0
  let line = 0
  tokens.forEach((token, i) => {
    if (start >= 0 || token.type !== 'space') {
      if (start < 0) [start, first] = [i, line]
      open = Math.max(0, opened([token], open))
      if (!open) {
        out.push(span(tokens, start, i, first))
        start = -1
      }
    }
    line += (token.raw.match(/\n/g) ?? []).length
  })
  if (start >= 0) out.push(span(tokens, start, tokens.length - 1, first))
  return out
}

/** The run of `tokens` from `start` to `end`, both included, standing at `line`. */
function span(tokens, start, end, line) {
  const own = tokens.slice(start, end + 1)
  return { start, end, line, tokens: own, raw: own.map((t) => t.raw).join(''), html: hasHtml(own) }
}

// Whether a run with HTML in it leaves nothing open, by its source, as the
// browser said when last asked. Rebuilt from what each pass asks.
let verdicts = new Map()

/**
 * The runs, each with HTML in it made to close all it opens: one that the
 * browser finds left open takes in the runs after it, one, then two, then
 * four, until it closes or the note ends. A run with no HTML is Markdown's,
 * which always closes. The last run need not close: nothing follows it.
 */
function settle(all, tokens) {
  const asked = verdicts
  verdicts = new Map()
  const closes = (run) => {
    const shut = asked.get(run.raw) ?? verdicts.get(run.raw) ?? !leavesOpen(run.tokens, tokens.links)
    verdicts.set(run.raw, shut)
    return shut
  }
  const out = []
  for (let i = 0; i < all.length; i++) {
    let run = all[i]
    for (let more = 1; run.html && i + 1 < all.length && !closes(run); more *= 2) {
      const last = Math.min(all.length - 1, i + more)
      run = span(tokens, run.start, all[last].end, run.line)
      i = last
    }
    out.push(run)
  }
  return out
}

/**
 * The runs' nodes, from their rendering, and the elements in them that carry a
 * data-line, with that line counted from the run's first: where a run stands
 * is set on each pass, since a block above it may have gained or lost lines.
 *
 * Unless the run is bound to its line. HTML can take the markup after it for
 * text, as a <textarea> left open in a paragraph does, or into an attribute, as
 * a quote never closed does, and the line numbers in that markup then show
 * where no data-line can be set. Fewer data-line attributes than were written
 * tell so; a run whose own HTML writes one is bound too. Such a run is kept
 * only where it stood.
 *
 * The HTML is parsed in one go, the runs told apart by a comment between them,
 * which the sanitiser has taken out of everything else. Should one not stand
 * between two runs, they are parsed one by one.
 */
function build(rendered, runs) {
  const template = document.createElement('template')
  template.innerHTML = rendered.map((r) => r.html).join('<!---->')
  const groups = [[]]
  for (const node of [...template.content.childNodes]) {
    if (node.nodeType === Node.COMMENT_NODE && rendered.length > 1) groups.push([])
    else groups.at(-1).push(node)
  }
  if (groups.length !== rendered.length) return rendered.flatMap((r, k) => build([r], [runs[k]]))
  return groups.map((nodes, k) => {
    const { line, html, raw } = runs[k]
    const marks = []
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      for (const el of [node, ...node.querySelectorAll('[data-line]')]) {
        if (el.hasAttribute('data-line')) marks.push([el, Number(el.dataset.line) - line])
      }
    }
    const bound = html && (raw.includes('data-line') || marks.length !== rendered[k].written)
    return { nodes, marks, index: 0, line, bound }
  })
}

/**
 * The one of `candidates`, the rendered runs of one source, that stood nearest
 * `index` last time, taken out of them; one bound to a line (see build) only
 * on that line. A paragraph written twice is two runs of one source; handed
 * out in order, an edit above the second would give it the first one's nodes,
 * and every run after it would move.
 */
function take(candidates, index, line) {
  let best = -1
  candidates?.forEach((part, k) => {
    if (part.bound && part.line !== line) return
    if (best < 0 || Math.abs(part.index - index) < Math.abs(candidates[best].index - index)) best = k
  })
  return best < 0 ? null : candidates.splice(best, 1)[0]
}

// The rendered runs of the last note shown, by their source, one for each time
// that source occurs. Rebuilt from what each pass uses, so it holds one note.
let parts = new Map()
let linksSeen = null

/**
 * Show `markdown` in `root` as `render(markdown, { lines: 0 })` would, reusing
 * what has not changed since the last call. The reference links belong to the
 * whole note, so a change to them renders everything again.
 */
export function showNote(root, markdown) {
  const tokens = marked.lexer(markdown ?? '')
  const links = JSON.stringify(tokens.links)
  const old = links === linksSeen ? parts : new Map()
  linksSeen = links
  parts = new Map()

  const all = settle(runs(tokens), tokens)
  // How far the runs stand from where they stood last time, as of the last one
  // found: where to look for the next.
  let shift = 0
  const placed = all.map((run, i) => {
    const part = take(old.get(run.raw), i + shift, run.line)
    if (part) shift = part.index - i
    return part
  })
  const missing = all.filter((_, i) => !placed[i])
  if (missing.length) {
    const built = build(renderRuns(missing, tokens.links), missing)
    let j = 0
    for (let i = 0; i < all.length; i++) placed[i] ??= built[j++]
  }

  const nodes = []
  all.forEach((run, i) => {
    const part = placed[i]
    part.index = i
    if (parts.has(run.raw)) parts.get(run.raw).push(part)
    else parts.set(run.raw, [part])
    // A run bound to its line stands where it was rendered; the note's own
    // data-line in it, if any, is the note's.
    if (!part.bound) for (const [el, offset] of part.marks) {
      const line = String(run.line + offset)
      if (el.getAttribute('data-line') !== line) el.setAttribute('data-line', line)
    }
    nodes.push(...part.nodes)
  })
  patchChildren(root, nodes)
}
