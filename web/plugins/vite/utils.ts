export const normalizeViteModuleId = (id: string): string => {
  const withoutQuery = id.split('?', 1)[0]

  if (withoutQuery.startsWith('/@fs/'))
    return withoutQuery.slice('/@fs'.length)

  return withoutQuery
}

export const injectClientSnippet = (code: string, marker: string, snippet: string): string => {
  if (code.includes(marker))
    return code

  const useClientMatch = code.match(/(['"])use client\1;?\s*\n/)
  if (!useClientMatch)
    return `${snippet}\n${code}`

  const insertAt = (useClientMatch.index ?? 0) + useClientMatch[0].length
  return `${code.slice(0, insertAt)}\n${snippet}\n${code.slice(insertAt)}`
}
