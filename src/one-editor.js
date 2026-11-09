// One editor at a time in a browser. Each editor page holds its open notes in
// memory and writes them back whole, so two pages on the same notes wrote over
// each other's edits without a word: whichever wrote last won. Notes need no
// merging, so rather than merge, only one page writes. It holds a lock (Web
// Locks), and a page that finds the lock taken says the notes are open in
// another tab and starts nothing. "Use this tab" asks the page that has them,
// over a BroadcastChannel, to store what it holds and let go; one that does
// not answer, frozen or hung, has the lock taken from it after a while.

// A reload of this very tab lets go of the lock as the old page goes, which
// can be a moment after the new one asks.
const WAIT_AT_START = 700
// How long the page that has the notes gets to store them and let go.
const WAIT_FOR_HOLDER = 3000

/** Without Web Locks every page writes, as before. */
export const supported = typeof navigator !== 'undefined' && Boolean(navigator.locks) && typeof BroadcastChannel !== 'undefined'

let name = null
let channel = null
let release = null // lets go of the lock while this page holds it
let onLost = () => {}

/**
 * Take the lock: only if free, waiting up to `ms`, or from whoever has it
 * (`steal`). Resolves true once this page holds it, false if it does not.
 */
function take({ ms = 0, steal = false } = {}) {
  return new Promise((resolve) => {
    const options = steal ? { steal: true } : ms ? { signal: AbortSignal.timeout(ms) } : { ifAvailable: true }
    let held = false
    navigator.locks.request(name, options, (lock) => {
      if (!lock) return resolve(false)
      held = true
      resolve(true)
      return new Promise((done) => { release = done })
    }).catch(() => {
      if (!held) return resolve(false) // the wait ran out
      // Taken by another page, without asking this one first.
      release = null
      onLost('taken')
    })
  })
}

/**
 * Become the one editor of the notes behind the lock `lockName`, unless
 * another page is. Resolves true once this page may write, false if another
 * has the notes; then nothing should start before takeOver(). `stored` is run
 * when another page asks for the notes, to write what this page holds before
 * it lets go; `lost` whenever this page stops being the editor, with 'handed'
 * after `stored` or 'taken' when another page took the lock without an answer.
 */
export async function claim(lockName, { stored, lost }) {
  if (!supported) return true
  name = lockName
  onLost = lost
  channel = new BroadcastChannel(lockName)
  channel.onmessage = async (e) => {
    if (e.data !== 'release' || !release) return
    try { await stored() } catch (err) { console.error(err) }
    const letGo = release
    release = null
    onLost('handed')
    letGo()
  }
  return (await take()) || take({ ms: WAIT_AT_START })
}

/**
 * Take the notes over: ask the page that has them to let go, and wait for it;
 * from one that does not answer, take them anyway.
 */
export async function takeOver() {
  if (!supported) return
  channel.postMessage('release')
  if (await take({ ms: WAIT_FOR_HOLDER })) return
  await take({ steal: true })
}
