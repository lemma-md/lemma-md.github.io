// Links into help/, a page per section: the FAQ, troubleshooting and so on.
// Each answer there has an anchor that is permanent, because the app links to
// it, from a notice that says a browser setting is in the way, for example. A
// link opens in a new tab, so the editor and whatever it holds in memory stay
// where they are.
export const helpUrl = (page, section) =>
  new URL(`../help/${page}/${section ? `#${section}` : ''}`, import.meta.url).href
