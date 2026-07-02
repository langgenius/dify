type QueryArrayCompatibilityRule = {
  path: RegExp
  fields: readonly string[]
}

// Bridge oRPC indexed query arrays to Flask handlers that read repeated keys with getlist().
const repeatedQueryArrayRules: readonly QueryArrayCompatibilityRule[] = [
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
  { path: /\/workspaces\/current\/tool-provider\/builtin\/[^/]+\/credential\/info$/, fields: ['include_credential_ids'] },
  { path: /\/workspaces\/current\/tool-provider\/builtin\/[^/]+\/credentials$/, fields: ['include_credential_ids'] },
]

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getRepeatedQueryArrayFields = (pathname: string) =>
  repeatedQueryArrayRules.find(rule => rule.path.test(pathname))?.fields ?? []

const rewriteIndexedQueryArrayParam = (url: URL, field: string) => {
  const indexedParamPattern = new RegExp(`^${escapeRegExp(field)}\\[(\\d+)\\]$`)
  const values: Array<{ index: number, value: string }> = []
  const indexedKeys = new Set<string>()

  url.searchParams.forEach((value, key) => {
    const match = indexedParamPattern.exec(key)
    if (!match)
      return

    indexedKeys.add(key)
    values.push({ index: Number(match[1]), value })
  })

  if (!values.length)
    return false

  indexedKeys.forEach(key => url.searchParams.delete(key))
  values
    .sort((a, b) => a.index - b.index)
    .forEach(({ value }) => url.searchParams.append(field, value))

  return true
}

export function normalizeConsoleOpenAPIURL(url: string | URL) {
  const normalizedUrl = new URL(url)
  const repeatedQueryArrayFields = getRepeatedQueryArrayFields(normalizedUrl.pathname)

  if (!repeatedQueryArrayFields.length)
    return normalizedUrl.href

  repeatedQueryArrayFields.forEach(field => rewriteIndexedQueryArrayParam(normalizedUrl, field))

  return normalizedUrl.href
}
