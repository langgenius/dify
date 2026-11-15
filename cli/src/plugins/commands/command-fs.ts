function normalize(p: string): string {
  return p.replace(/\\/g, '/')
}

export function isExcludedCommandPath(relPath: string): boolean {
  return normalize(relPath)
    .split('/')
    .some((seg) => seg.startsWith('_'))
}

export function isCommandIndexPath(relPath: string): boolean {
  const n = normalize(relPath)
  if (!n.endsWith('/index.ts')) return false
  return !isExcludedCommandPath(n)
}
