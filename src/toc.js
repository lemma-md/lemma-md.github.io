// The page's contents, in the column on its left (landing.css → the page). On
// a narrow screen they are a panel behind the ☰ button; on any screen the
// entry for the part being read is marked. Without this script the contents
// simply stay open above the page.
//
// The entries are read afresh whenever they change, so a page may fill them
// after loading; a group with nothing in it is not shown, and contents with
// nothing at all are not shown, nor is the ☰ button.

const toc = document.getElementById('toc')
const toggle = document.querySelector('.toc-toggle')
document.body.classList.add('toc-ready')

const setOpen = (open) => {
  toc.classList.toggle('open', open)
  toggle.setAttribute('aria-expanded', String(open))
}
toggle.onclick = () => setOpen(!toc.classList.contains('open'))
toc.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false) })
document.addEventListener('click', (e) => {
  if (toc.classList.contains('open') && !toc.contains(e.target) && !toggle.contains(e.target)) setOpen(false)
})
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false) })

// The part being read is the last one whose top has passed a line near the top
// of the window; at the very bottom, the last one. Entries that lead to another
// page are never marked.
//
// Except for the part the reader chose, by an entry or by the address: it stays
// marked while its top is in the window. On a short page the jump to it ends at
// the bottom, before its top reaches the line, and the rules above would mark
// the part after it instead.
const target = (a) => decodeURIComponent(a.hash.slice(1))
let chosen = decodeURIComponent(location.hash.slice(1))
toc.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]')
  if (a) chosen = target(a)
})
addEventListener('hashchange', () => { chosen = decodeURIComponent(location.hash.slice(1)) })

function mark() {
  const links = [...toc.querySelectorAll('a[href^="#"]')]
  const parts = links.map((a) => document.getElementById(target(a)))
  let current = -1
  parts.forEach((part, i) => { if (part && part.getBoundingClientRect().top <= 120) current = i })
  if (links.length && innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = links.length - 1
  const picked = chosen ? links.findIndex((a) => target(a) === chosen) : -1
  const top = picked >= 0 && parts[picked] ? parts[picked].getBoundingClientRect().top : NaN
  if (top >= -1 && top < innerHeight) current = picked
  else chosen = ''
  links.forEach((a, i) => {
    if (i === current) a.setAttribute('aria-current', 'true')
    else a.removeAttribute('aria-current')
  })
}

function update() {
  // A group with nothing in it is not shown, nor its title; contents with
  // nothing at all are not shown, nor the ☰ button.
  for (const list of toc.querySelectorAll('ul')) {
    const none = !list.querySelector('li')
    list.hidden = none
    const title = list.previousElementSibling
    if (title?.classList.contains('toc-title')) title.hidden = none
  }
  const empty = !toc.querySelector('li')
  toc.hidden = empty
  toggle.hidden = empty
  if (empty) setOpen(false)
  mark()
}

new MutationObserver(update).observe(toc, { childList: true, subtree: true })
addEventListener('scroll', mark, { passive: true })
addEventListener('resize', mark)
addEventListener('hashchange', mark)
addEventListener('load', mark) // after the jump to a #part the page was opened at
update()
