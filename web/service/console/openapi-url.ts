// These Python endpoints expect repeated keys; oRPC v1 serializes arrays with indexed keys.
const repeatedQueryArrayRules = [
  { path: /\/agent$/, fields: ['tag_ids', 'creator_ids'] },
  { path: /\/agent\/[^/]+\/logs$/, fields: ['sources', 'statuses'] },
  { path: /\/agent\/[^/]+\/logs\/[^/]+\/messages$/, fields: ['sources', 'statuses'] },
  { path: /\/apps$/, fields: ['tag_ids', 'creator_ids'] },
  { path: /\/apps\/starred$/, fields: ['tag_ids', 'creator_ids'] },
  { path: /\/datasets$/, fields: ['ids', 'tag_ids'] },
  { path: /\/datasets\/[^/]+\/documents\/[^/]+\/segment\/[^/]+$/, fields: ['segment_id'] },
  { path: /\/datasets\/[^/]+\/documents\/[^/]+\/segments$/, fields: ['segment_id', 'status'] },
  { path: /\/trial-apps\/[^/]+\/datasets$/, fields: ['ids'] },
  { path: /\/workspaces\/current\/customized-snippets$/, fields: ['tag_ids', 'creators'] },
  { path: /\/workspaces\/current\/skills$/, fields: ['tag'] },
  { path: /\/workspaces\/current\/plugin\/[^/]+\/list$/, fields: ['tags'] },
  {
    path: /\/workspaces\/current\/tool-provider\/builtin\/[^/]+\/credential\/info$/,
    fields: ['include_credential_ids'],
  },
  {
    path: /\/workspaces\/current\/tool-provider\/builtin\/[^/]+\/credentials$/,
    fields: ['include_credential_ids'],
  },
]

export function normalizeConsoleOpenAPIURL(url: string | URL) {
  const normalizedUrl = new URL(url)
  const rule = repeatedQueryArrayRules.find(({ path }) => path.test(normalizedUrl.pathname))

  for (const field of rule?.fields ?? []) {
    const pattern = new RegExp(`^${field}\\[(\\d+)\\]$`)
    const values: Array<{ index: number; value: string }> = []
    const indexedKeys = new Set<string>()

    for (const [key, value] of normalizedUrl.searchParams) {
      const match = pattern.exec(key)
      if (!match) continue
      indexedKeys.add(key)
      values.push({ index: Number(match[1]), value })
    }

    for (const key of indexedKeys) normalizedUrl.searchParams.delete(key)
    for (const { value } of values.sort((a, b) => a.index - b.index))
      normalizedUrl.searchParams.append(field, value)
  }

  return normalizedUrl.href
}
