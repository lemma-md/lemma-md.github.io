// A test runner small enough to read in one sitting, so that the tests need
// nothing installed: no npm, no framework. Test files call suite() and test();
// index.html imports them and calls run().
//
// Tests run one after another, each with a time limit, since an await that
// never settles (a storage write nobody answers, say) is a failure too.

const tests = []
let currentSuite = ''

/** Name the group the following tests belong to. */
export function suite(name) {
  currentSuite = name
}

/** Register a test. `fn` may be async; throwing fails it. */
export function test(name, fn) {
  tests.push({ suite: currentSuite, name, fn })
}

export class AssertionError extends Error {}

const show = (v) => JSON.stringify(v)
const label = (what) => (what ? `${what}: ` : '')

export const assert = {
  equal(actual, expected, what = '') {
    if (!Object.is(actual, expected)) {
      throw new AssertionError(`${label(what)}expected ${show(expected)}, got ${show(actual)}`)
    }
  },
  /** Equal as JSON: for arrays and plain objects. */
  deepEqual(actual, expected, what = '') {
    const a = show(actual)
    const e = show(expected)
    if (a !== e) throw new AssertionError(`${label(what)}expected ${e}, got ${a}`)
  },
  ok(value, what = 'expected a true value') {
    if (!value) throw new AssertionError(what)
  },
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Run every registered test and list the results in `out`. The summary also
 * goes into the page title and `window.testResults`, for whatever drives the
 * page without looking at it.
 */
export async function run(out, { timeout = 10000 } = {}) {
  const summary = document.createElement('p')
  summary.className = 'summary'
  summary.textContent = `Running ${tests.length} tests…`
  const list = document.createElement('ol')
  out.append(summary, list)

  const failures = []
  for (const t of tests) {
    let error = null
    try {
      await withTimeout(Promise.resolve().then(t.fn), timeout)
    } catch (err) {
      error = err
      failures.push({ suite: t.suite, name: t.name, message: String(err?.message ?? err) })
    }

    const li = document.createElement('li')
    li.className = error ? 'fail' : 'pass'
    const title = document.createElement('span')
    title.textContent = `${error ? '✗' : '✓'} ${t.suite ? `${t.suite} › ` : ''}${t.name}`
    li.append(title)
    if (error) {
      const why = document.createElement('pre')
      why.textContent = error instanceof AssertionError ? error.message : String(error?.stack ?? error)
      li.append(why)
    }
    list.append(li)
  }

  const text = failures.length
    ? `FAIL ${failures.length} of ${tests.length}`
    : `PASS ${tests.length}`
  summary.textContent = text
  summary.classList.add(failures.length ? 'fail' : 'pass')
  document.title = text
  window.testResults = { total: tests.length, failed: failures.length, failures }
  return window.testResults
}
