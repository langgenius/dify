export function namespacesOf(ids: readonly string[], sep: string): ReadonlySet<string> {
  const out = new Set<string>()
  for (const id of ids) {
    const parts = id.split(sep)
    for (let depth = 1; depth < parts.length; depth++) out.add(parts.slice(0, depth).join(sep))
  }
  return out
}

export function under(namespace: string, ids: readonly string[], sep: string): string[] {
  const prefix = `${namespace}${sep}`
  return ids.filter((id) => id.startsWith(prefix))
}

export function byHead(
  ids: readonly string[],
  sep: string,
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>()
  for (const id of [...ids].sort()) {
    const at = id.indexOf(sep)
    const head = at === -1 ? id : id.slice(0, at)
    const rest = out.get(head) ?? []
    if (at !== -1) rest.push(id.slice(at + 1))
    out.set(head, rest)
  }
  return out
}

export function groupsOf(remainders: readonly string[], sep: string): string[] {
  const groups = new Set<string>()
  for (const rest of remainders) {
    const at = rest.indexOf(sep)
    if (at !== -1) groups.add(rest.slice(0, at))
  }
  return [...groups]
}
