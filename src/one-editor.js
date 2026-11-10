// One editor at a time in a browser. Each editor page holds its open notes in
// memory and writes them back whole, so two pages on the same notes wrote over
// each other's edits without a word: whichever wrote last won. Notes need no
// merging, so rather than merge, only one page writes. It holds a lock (Web
// Locks), and a page that finds the lock taken says the notes are open in
// another tab and starts nothing.
//
// "Use this tab" asks the page that has the notes, over a BroadcastChannel, to
// hand them over. That page answers at once that it is on it ('busy'), then
// stores what it holds, waiting for any save to a file or to Drive already
// under way, and lets go only once all of it is stored. Letting go before,
// its late save landed after the new page's, over it. If it cannot store
// everything, it keeps the notes and says why ('refused'). A page that does
// not answer at all, frozen or closing, can have the lock taken from it, but
// only on the person's say-so: what it typed last, or a save it was making,
// may then be lost.
//
// Two pages may ask at once. The one handing over answers both that it is on
// it, then lets go to whichever the lock goes to; that page says it has the
// notes ('holder'), and the other stops waiting, free to ask the new one.

// A reload of this very tab lets go of the lock as the old page goes, which
// can be a moment after the new one asks.
const WAIT_AT_START = 700
// How long the page that has the notes gets to answer that it is on it.
const WAIT_FOR_ANSWER = 1500

/** Without Web Locks every page writes, as before. */
export const supported = typeof navigator !== 'undefined' && Boolean(navigator.locks) && typeof BroadcastChannel !== 'undefined'

let name = null
let channel = null
let release = null // lets go of the lock while this page holds it
let onLost = () => {}
let asking = null // this page's request for the notes, while it waits

/**
 * Take the lock: only if free; waiting up to `ms`, or until `signal` aborts;
 * or from whoever has it (`steal`). Resolves true once this page holds it,
 * false if it does not.
 */
function take({ ms = 0, signal = null, steal = false } = {}) {
  return new Promise((resolve) => {
    const options = steal ? { steal: true }
      : signal ? { signal }
      : ms ? { signal: AbortSignal.timeout(ms) }
      : { ifAvailable: true }
    let held = false
    navigator.locks.request(name, options, (lock) => {
      if (!lock) return resolve(false)
      held = true
      // A page still waiting for the notes waits no more: they are here now.
      channel.postMessage({ type: 'holder' })
      resolve(true)
      return new Promise((done) => { release = done })
    }).catch(() => {
      if (!held) return resolve(false) // the wait ran out, or was given up
      // Taken by another page, without waiting for this one.
      release = null
      onLost('taken')
    })
  })
}

/**
 * Become the one editor of the notes behind the lock `lockName`, unless
 * another page is. Resolves true once this page may write, false if another
 * has the notes; then nothing should start before takeOver(). `handOver` is
 * run when another page asks for the notes: it stores what this page holds,
 * and resolves null once all of it is stored, or why not. `lost` is run
 * whenever this page stops being the editor, with 'handed' after `handOver`,
 * or 'taken' when another page took the lock without waiting.
 */
export async function claim(lockName, { handOver, lost }) {
  if (!supported) return true
  name = lockName
  onLost = lost
  channel = new BroadcastChannel(lockName)
  let handing = false
  channel.onmessage = async (e) => {
    const { type, reason } = e.data ?? {}
    if (type === 'busy' || type === 'refused' || type === 'holder') return asking?.hear(type, reason)
    if (type !== 'release' || !release) return
    // A second page asking meanwhile hears that this one is on it too.
    if (handing) return channel.postMessage({ type: 'busy' })
    handing = true
    channel.postMessage({ type: 'busy' })
    let refusal = null
    try { refusal = await handOver() } catch (err) { console.error(err); refusal = 'error' }
    handing = false
    if (!release) return // taken meanwhile
    if (refusal) return channel.postMessage({ type: 'refused', reason: refusal })
    const letGo = release
    release = null
    onLost('handed')
    letGo()
  }
  return (await take()) || take({ ms: WAIT_AT_START })
}

/**
 * Ask the page that has the notes to hand them over. Resolves 'taken' once
 * this page holds them; { refused: reason } when that page cannot let go
 * without losing something; 'silent' when it does not answer; 'raced' when it
 * let go to another page that asked at the same time. `busy` is run once it
 * has answered that it is storing what it holds; the wait then lasts as long
 * as that takes.
 */
export function takeOver({ busy = () => {} } = {}) {
  if (!supported) return Promise.resolve('taken')
  return new Promise((resolve) => {
    const controller = new AbortController()
    let answered = false
    let silence = 0
    const ask = {
      finish(result) {
        if (asking !== ask) return
        asking = null
        clearTimeout(silence)
        resolve(result)
      },
      hear(type, reason) {
        if (type === 'busy') {
          if (!answered) busy()
          answered = true
        } else {
          controller.abort()
          ask.finish(type === 'holder' ? 'raced' : { refused: reason })
        }
      },
      give() {
        controller.abort()
        ask.finish('silent')
      },
    }
    asking = ask
    silence = setTimeout(() => { if (!answered) ask.give() }, WAIT_FOR_ANSWER)
    take({ signal: controller.signal }).then((held) => { if (held) ask.finish('taken') })
    channel.postMessage({ type: 'release' })
  })
}

/**
 * Take the notes from a page that does not answer, or answers but does not
 * let go, without waiting for it: on the person's say-so, since what that page
 * typed last, or a save it was making, may be lost. A request still waiting
 * is given up; it resolves 'silent'.
 */
export async function takeAnyway() {
  if (!supported) return
  asking?.give()
  await take({ steal: true })
}
