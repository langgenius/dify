import fs from 'node:fs'
import path from 'node:path'

const PLURAL = /_(?:zero|one|two|few|many|other)$/
export const camelCase = (name: string) =>
  name.replace(/[-_]+([a-z0-9])/gi, (_, char: string) => char.toUpperCase())

export function readTranslationCatalog(root: string) {
  const directory = path.join(root, 'i18n/locales/en-US')
  const catalog = new Map<string, Set<string>>()
  const exact = new Map<string, Map<string, Set<string>>>()
  for (const file of fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    const content: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
    if (!content || typeof content !== 'object' || Array.isArray(content))
      throw new Error(`Invalid translation catalog: ${file}`)
    const namespace = camelCase(file.slice(0, -5))
    const keys = new Set(Object.keys(content))
    catalog.set(namespace, keys)
    const index = new Map<string, Set<string>>()
    for (const key of keys) {
      for (const lookup of new Set([key, key.replace(PLURAL, '')])) {
        const matches = index.get(lookup) ?? new Set<string>()
        matches.add(key)
        index.set(lookup, matches)
      }
    }
    exact.set(namespace, index)
  }
  const patterns = new Map<string, Map<string, string[]>>()
  return {
    catalog,
    match(namespace: string, text: string, wildcard: boolean): Iterable<string> {
      if (!wildcard) return exact.get(namespace)?.get(text) ?? []
      const cached = patterns.get(namespace) ?? new Map<string, string[]>()
      let matches = cached.get(text)
      if (!matches) {
        const regex = new RegExp(`^${text}$`)
        matches = [...(catalog.get(namespace) ?? [])].filter(
          (key) => regex.test(key) || regex.test(key.replace(PLURAL, '')),
        )
        cached.set(text, matches)
        patterns.set(namespace, cached)
      }
      return matches
    },
  }
}
