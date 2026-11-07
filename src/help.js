// Links into the help page: one page, help/, beside editor/. Each question there
// is a section whose anchor is permanent, because the app links to it, from a
// notice that says a browser setting is in the way, for example. A link opens
// in a new tab, so the editor and whatever it holds in memory stay where they are.
export const helpUrl = (section) =>
  new URL(`../help/${section ? `#${section}` : ''}`, import.meta.url).href
