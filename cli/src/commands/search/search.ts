type SearchEffect = 'read' | 'write' | 'destructive'

export type SearchDocument = {
  readonly path: string
  readonly description: string | null
  readonly effect: SearchEffect
  readonly flags: readonly {
    readonly name: string
    readonly description: string
  }[]
  readonly agentGuide: string | null
}

export type SearchResult = {
  readonly path: string
  readonly description: string | null
  readonly effect: SearchEffect
  readonly score: number
}

const PATH_WEIGHT = 4
const DESCRIPTION_WEIGHT = 2
const DETAIL_WEIGHT = 1

function normalizeToken(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !/(?:is|ss|us)$/.test(token))
    return token.slice(0, -1)

  return token
}

function tokenize(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(normalizeToken))
}

function documentScore(query: ReadonlySet<string>, document: SearchDocument): number {
  const path = tokenize(document.path)
  const description = tokenize(document.description ?? '')
  const details = tokenize(
    [
      ...document.flags.flatMap((flag) => [flag.name, flag.description]),
      document.agentGuide ?? '',
    ].join(' '),
  )

  let score = 0
  for (const token of query) {
    if (path.has(token)) score += PATH_WEIGHT
    else if (description.has(token)) score += DESCRIPTION_WEIGHT
    else if (details.has(token)) score += DETAIL_WEIGHT
  }

  return score
}

export function searchCommands(
  intent: string,
  documents: readonly SearchDocument[],
): SearchResult[] {
  const query = tokenize(intent)
  if (query.size === 0) return []

  return documents
    .map((document) => ({ document, score: documentScore(query, document) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.document.path < b.document.path ? -1 : a.document.path > b.document.path ? 1 : 0),
    )
    .map(({ document, score }) => ({
      path: document.path,
      description: document.description,
      effect: document.effect,
      score,
    }))
}
