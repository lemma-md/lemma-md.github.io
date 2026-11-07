// The local server sends no cache headers, so after an edit the browser may
// still run the old copy of a module (CLAUDE.md → Verifying changes): a test
// would then pass or fail against code that is no longer on disk. Before any
// test module loads, this fetches every module the tests can reach, the app's
// own included, with `cache: 'reload'`, which puts the copy on disk into the
// cache that module loading reads from.

const seen = new Set()

/** Refresh the given modules and everything they import, transitively. */
export async function refresh(entries, base = location.href) {
  await Promise.all(entries.map((entry) => visit(new URL(entry, base).href)))
}

async function visit(url) {
  if (seen.has(url)) return
  seen.add(url)
  const response = await fetch(url, { cache: 'reload' }).catch(() => null)
  if (!response?.ok || !/\.js$/.test(new URL(url).pathname)) return
  const source = await response.text()
  // Relative specifiers in `import … from '…'`, `import '…'` and `import('…')`.
  const specifiers = source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(['"])(\.{1,2}\/[^'"]+)\1/g)
  await Promise.all([...specifiers].map((m) => visit(new URL(m[2], url).href)))
}
