// Starter notes offered by "New from template". Kept as plain strings here
// rather than fetched files: they are small, must work offline, and the welcome
// text doubles as the note seeded on a first-ever visit (see app.js).

export const WELCOME = `# Welcome to lemma-md

You are reading this note as a finished page. Press **Edit** to see the plain
text behind it: source on the left, result on the right, changing as you type.

Inline formulas go between single dollars: $e^{i\\pi} + 1 = 0$.
Display formulas go between double dollars:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## The markdown you actually need

- \`#\` starts a heading, \`##\` a subheading
- \`*italic*\` gives *italic*, \`**bold**\` gives **bold**
- a line starting with \`-\` becomes a list item

That is the whole language. Everything else is optional.

## Anything TeX-shaped works

$$
\\begin{aligned}
  (a+b)^2 &= a^2 + 2ab + b^2 \\\\
  \\zeta(s) &= \\sum_{n=1}^{\\infty} \\frac{1}{n^s}
\\end{aligned}
$$

> Drafts live in **this browser only** — nothing is uploaded anywhere.
> Use *Download as .md* in the menu to keep a copy as a file.
`

export const DEMO_SLIDES = `---
title: Presenting with lemma-md
author: Your name
affiliation: Your institution
place: Your seminar or conference
date: September 11, 2026
---

# A deck is just a note

Separate slides with a line of three dashes:

    ---

Everything you already write — **Markdown** and $\\TeX$ — works on a slide.

---

## Formulas, full size

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

- press the right arrow or the space bar to advance
- press Esc for an overview of every slide

---

<!-- center -->

## Drawing over the slide

The toolbar down the left has a **laser pointer**, a **pen**, a
semi-transparent **highlighter**, and an **eraser** that rubs out the part you
drag over.

Your marks are saved with the note, so they come back the next time you present.

---

## Tables render too

| Tool | What it does |
|-------------|-------------------------------------------|
| Laser | a red dot; hold to leave a fading trail |
| Pen | draws in the chosen colour |
| Highlighter | a translucent marker over the text |
| Eraser | rubs out the part you drag over |

---

## Merged cells? Drop in HTML

Markdown tables can't merge cells, but an HTML table can — and it renders too:

<table>
<thead>
<tr><th rowspan="2">Name</th><th colspan="2">Scores</th></tr>
<tr><th>Math</th><th>Physics</th></tr>
</thead>
<tbody>
<tr><td>Ann</td><td>5</td><td>4</td></tr>
<tr><td>Bob</td><td>3</td><td>5</td></tr>
</tbody>
</table>

---

<!-- center -->

# Your turn

Press **Edit**, change this text, then **Present** — the projector opens in a
window of its own.

Links work too — hold **Ctrl** and click [example.com](https://example.com).
`

/**
 * The templates offered in the picker, in order. `mode` is how the new note
 * opens: a blank note lands in the editor (an invitation to type), the others in
 * reading view so their result is what you see first. `icon` is a sprite symbol
 * id from editor/index.html.
 */
export const templates = [
  { id: 'blank', name: 'untitled.md', label: 'Blank note', description: 'Start from nothing.', text: '# \n', mode: 'edit', icon: 'icon-new' },
  { id: 'welcome', name: 'welcome.md', label: 'Welcome & basics', description: 'Markdown and TeX in five minutes.', text: WELCOME, mode: 'view', icon: 'icon-info' },
  { id: 'slides', name: 'demo-slides.md', label: 'Slide demo', description: 'A short deck — open it, then Present (Alt+P).', text: DEMO_SLIDES, mode: 'view', icon: 'icon-present' },
]
