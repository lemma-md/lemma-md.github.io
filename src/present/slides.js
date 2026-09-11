// Turn a note's markdown into a deck description: an optional title slide from
// front-matter, then one slide per `---`-separated chunk, each carrying any
// directive it declared. Mostly text parsing (rendering, through the app's
// single render() pipeline, happens in the callers); the one piece of DOM here
// is buildTitleBody, shared by the projector and the editor preview so the
// title page is laid out identically in both.

/**
 * Pull a leading YAML-ish front-matter block off the markdown.
 *
 * The block is recognised only when the very first line is exactly `---`, which
 * is the standard rule (Jekyll, Marp) and the reason it does not collide with
 * `---` used as a slide separator further down. Parsing is deliberately tiny —
 * flat `key: value` lines, quotes trimmed — rather than a real YAML dependency,
 * because the title slide needs nothing more.
 *
 * Returns { meta, body }: `meta` is null when there is no front-matter, else an
 * object of the parsed keys; `body` is the markdown with the block removed.
 */
export function extractFrontMatter(md) {
  const text = String(md ?? '')
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { meta: null, body: text }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break }
  }
  if (end === -1) return { meta: null, body: text } // no closing fence: not front-matter

  const meta = {}
  for (const line of lines.slice(1, end)) {
    const m = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    meta[m[1].toLowerCase()] = m[2].trim().replace(/^["'](.*)["']$/, '$1')
  }
  // Only a block that parsed at least one `key: value` counts as front-matter.
  // Otherwise the leading `---` was a slide separator (or an empty first slide),
  // and swallowing the block would silently drop that first slide's content.
  if (Object.keys(meta).length === 0) return { meta: null, body: text }
  return { meta, body: lines.slice(end + 1).join('\n') }
}

/**
 * Split markdown into slide chunks on lines that are exactly `---`, but never
 * inside a fenced code block or a `$$…$$` math block — a horizontal rule the
 * author wrote as content, or a `---` that happens to sit in code, must not cut
 * the deck. Math is tracked by counting `$$` per line (an odd count toggles the
 * state, so `$$x$$` on one line is a no-op while a lone `$$` opens or closes).
 */
export function splitSlides(md) {
  const lines = String(md ?? '').split('\n')
  const chunks = []
  let current = []
  let inFence = false
  let inMath = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^(```|~~~)/.test(trimmed)) inFence = !inFence
    else if (!inFence) {
      const dollars = (line.match(/\$\$/g) || []).length
      if (dollars % 2 === 1) inMath = !inMath
    }

    if (!inFence && !inMath && /^---\s*$/.test(line)) {
      chunks.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  chunks.push(current.join('\n'))

  // Drop chunks that are only whitespace (a leading or trailing separator, or
  // two in a row), so `---` at the very top does not make an empty first slide.
  return chunks.filter((c) => c.trim() !== '')
}

/**
 * Read a leading directive comment off a chunk and strip it. A slide may start
 * with `<!-- center -->`, `<!-- class: foo -->` or `<!-- bg: #fff -->` (tokens
 * separated by whitespace or `;`), which become attributes on the slide rather
 * than content. Parsed before render(), so the comment never reaches DOMPurify.
 *
 * Returns { directives: { center, cls, bg }, md }.
 */
export function parseDirectives(chunk) {
  const directives = { center: false, cls: null, bg: null }
  const lines = String(chunk ?? '').split('\n')

  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++ // skip leading blanks
  const m = i < lines.length ? /^<!--\s*(.*?)\s*-->\s*$/.exec(lines[i].trim()) : null
  if (!m) return { directives, md: chunk }

  // Match each directive in the comment body regardless of how they are
  // separated (whitespace or `;`), so `class: big` survives the space after the
  // colon that a token split would have broken on.
  const body = m[1]
  if (/(^|[;\s])center([;\s]|$)/.test(body)) directives.center = true
  directives.cls = /\bclass:\s*([^;]+?)\s*(?:;|$)/.exec(body)?.[1] ?? null
  directives.bg = /\bbg:\s*([^;]+?)\s*(?:;|$)/.exec(body)?.[1] ?? null

  lines.splice(i, 1) // remove the directive line
  return { directives, md: lines.join('\n') }
}

/**
 * Parse a whole note into a deck: { title, slides }.
 *
 * `title` is the front-matter object (or null); present.js turns it into the
 * opening title slide. Each entry of `slides` is
 * { md, center, cls, bg } — content still as markdown, for render() to typeset.
 * A note with no `---` yields a single slide; an empty note yields none.
 */
/**
 * Build the title page's body from front-matter fields — shared by the projector
 * and the editor preview. Fields are grouped so the spacing is robust to any of
 * them being absent: a "who" block (author, affiliation) and a "when / where"
 * block (place, date), separated by a clear gap that lives on the block, not on
 * one field. Text is set with textContent, never innerHTML.
 */
export function buildTitleBody(meta) {
  const body = document.createElement('div')
  body.className = 'slide-body'
  const add = (parent, cls, text) => {
    if (!text) return
    const div = document.createElement('div')
    div.className = cls
    div.textContent = text
    parent.append(div)
  }

  add(body, 'deck-title', meta.title)

  const who = document.createElement('div')
  who.className = 'deck-who'
  add(who, 'deck-author', meta.author)
  add(who, 'deck-affiliation', meta.affiliation)
  if (who.childNodes.length) body.append(who)

  const when = document.createElement('div')
  when.className = 'deck-when'
  add(when, 'deck-place', meta.place)
  add(when, 'deck-date', meta.date)
  if (when.childNodes.length) body.append(when)

  return body
}

export function parseDeck(markdown) {
  const { meta, body } = extractFrontMatter(markdown)
  const slides = splitSlides(body).map((chunk) => {
    const { directives, md } = parseDirectives(chunk)
    return { md, center: directives.center, cls: directives.cls, bg: directives.bg }
  })
  return { title: meta, slides }
}
