import type { Example, JsonSchema } from '@/plugins/catalog'
import { editDistance } from '@/util/edit-distance'
import { isRecord } from '@/util/is-record'

export const FIELD = {
  Id: 'id',
  Summary: 'summary',
  Example: 'example',
  Input: 'input',
} as const
export type Field = (typeof FIELD)[keyof typeof FIELD]

const WEIGHT: Readonly<Record<Field, number>> = {
  [FIELD.Id]: 5,
  [FIELD.Summary]: 3,
  [FIELD.Example]: 2,
  [FIELD.Input]: 1,
}
const FIELDS = Object.values(FIELD)

export type Describable = Readonly<{
  summary: string
  input: JsonSchema
  examples: readonly Example[]
}>

export type SearchDoc = Readonly<{
  id: string
  deprecated: boolean
  fields: Readonly<Record<Field, readonly string[]>>
}>

export type SearchHit = Readonly<{ id: string; score: number }>
export type SearchResult = Readonly<{ hits: readonly SearchHit[]; total: number }>

const TOKEN_BREAK = /[^a-z0-9]+/
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'with',
])

const SCHEMA_KEYS_WITH_TEXT = ['description', 'title'] as const
const SCHEMA_DEPTH_LIMIT = 4

const RUNG_EXACT = 1
const RUNG_TERM_PREFIX = 0.6
const RUNG_TOKEN_PREFIX = 0.5
const RUNG_TYPO = 0.4
const RUNG_NONE = 0
const TERM_PREFIX_MIN = 3
const TOKEN_PREFIX_MIN = 4
const TYPO_MIN = 5
const TYPO_DISTANCE = 1

const K1 = 1.2
const B = 0.75

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 5 && token.endsWith('ing')) return undouble(token.slice(0, -3))
  if (token.length > 4 && token.endsWith('ed')) return undouble(token.slice(0, -2))
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function undouble(token: string): string {
  const last = token.at(-1)
  if (last === undefined || last !== token.at(-2) || 'lsz'.includes(last)) return token
  return token.slice(0, -1)
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(TOKEN_BREAK)
    .filter((token) => token !== '' && !STOPWORDS.has(token))
    .map(stem)
}

function schemaText(schema: unknown, depth: number, out: string[]): void {
  if (!isRecord(schema) || depth > SCHEMA_DEPTH_LIMIT) return
  for (const key of SCHEMA_KEYS_WITH_TEXT) {
    const value = schema[key]
    if (typeof value === 'string') out.push(value)
  }
  const properties = schema.properties
  if (isRecord(properties)) {
    for (const [name, child] of Object.entries(properties)) {
      out.push(name)
      schemaText(child, depth + 1, out)
    }
  }
  schemaText(schema.items, depth + 1, out)
}

export function searchDoc(id: string, source: Describable, deprecated: boolean): SearchDoc {
  const input: string[] = []
  schemaText(source.input, 0, input)
  return {
    id,
    deprecated,
    fields: {
      [FIELD.Id]: tokenize(id),
      [FIELD.Summary]: tokenize(source.summary),
      [FIELD.Example]: tokenize(source.examples.map((example) => example.title).join(' ')),
      [FIELD.Input]: tokenize(input.join(' ')),
    },
  }
}

function rung(term: string, token: string): number {
  if (term === token) return RUNG_EXACT
  if (term.length >= TERM_PREFIX_MIN && token.startsWith(term)) return RUNG_TERM_PREFIX
  if (token.length >= TOKEN_PREFIX_MIN && term.startsWith(token)) return RUNG_TOKEN_PREFIX
  if (term.length >= TYPO_MIN && editDistance(term, token) <= TYPO_DISTANCE) return RUNG_TYPO
  return RUNG_NONE
}

function frequency(term: string, tokens: readonly string[]): number {
  let total = 0
  for (const token of tokens) total += rung(term, token)
  return total
}

function averageLengths(docs: readonly SearchDoc[]): Record<Field, number> {
  const out = {} as Record<Field, number>
  for (const field of FIELDS) {
    const sum = docs.reduce((acc, doc) => acc + doc.fields[field].length, 0)
    out[field] = docs.length === 0 ? 0 : sum / docs.length
  }
  return out
}

function saturate(tf: number, length: number, average: number): number {
  const norm = average === 0 ? 1 : 1 - B + (B * length) / average
  return (tf * (K1 + 1)) / (tf + K1 * norm)
}

function idf(matching: number, total: number): number {
  return Math.log(1 + (total - matching + 0.5) / (matching + 0.5))
}

function compare(a: SearchDoc & SearchHit, b: SearchDoc & SearchHit): number {
  if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1
  if (a.score !== b.score) return b.score - a.score
  return a.id < b.id ? -1 : 1
}

export function search(
  docs: readonly SearchDoc[],
  query: string,
  opts: Readonly<{ limit: number }>,
): SearchResult {
  const terms = [...new Set(tokenize(query))]
  const average = averageLengths(docs)
  const scores = new Map<string, number>(docs.map((doc) => [doc.id, 0]))

  for (const term of terms) {
    const perDoc = docs.map((doc) => {
      const tf = {} as Record<Field, number>
      for (const field of FIELDS) tf[field] = frequency(term, doc.fields[field])
      return tf
    })
    const matching = perDoc.filter((tf) => FIELDS.some((field) => tf[field] > 0)).length
    if (matching === 0) continue
    const weightOfTerm = idf(matching, docs.length)
    docs.forEach((doc, at) => {
      const tf = perDoc[at]
      if (tf === undefined) return
      let score = 0
      for (const field of FIELDS) {
        if (tf[field] === 0) continue
        score += WEIGHT[field] * saturate(tf[field], doc.fields[field].length, average[field])
      }
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + weightOfTerm * score)
    })
  }

  const ranked = docs
    .map((doc) => ({ ...doc, score: scores.get(doc.id) ?? 0 }))
    .filter((doc) => doc.score > 0)
    .sort(compare)
  return {
    hits: ranked.slice(0, opts.limit).map(({ id, score }) => ({ id, score })),
    total: ranked.length,
  }
}
