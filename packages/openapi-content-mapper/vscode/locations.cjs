/** Read explicitly labeled backend links; leave other hover documentation links alone. */
function backendLocations(contents) {
  const locations = new Map()
  for (const content of contents) {
    const markdown = typeof content === 'string' ? content : content.value
    if (typeof markdown !== 'string') continue
    for (const match of markdown.matchAll(
      /\[Open backend implementation\]\((file:\/\/[^\s)]+)#L([1-9]\d*)\)/g,
    )) {
      const line = Number(match[2])
      if (!Number.isSafeInteger(line)) continue
      try {
        const url = new URL(match[1])
        if (url.protocol !== 'file:' || url.search || url.hash) continue
        locations.set(`${url.href}#${line}`, { uri: url.href, line })
      } catch {
        // Malformed optional metadata must not interfere with normal TS navigation.
      }
    }
  }
  return [...locations.values()]
}

module.exports = { backendLocations }
