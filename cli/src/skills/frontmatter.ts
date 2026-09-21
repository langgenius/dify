import { load } from 'js-yaml'
import { isRecord } from '@/util/is-record'

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/

export type Frontmatter = { readonly head: string; readonly body: string }

export function splitFrontmatter(text: string): Frontmatter | undefined {
  const match = FRONTMATTER_RE.exec(text)
  if (match === null) return undefined
  return { head: match[1] as string, body: text.slice(match[0].length) }
}

export function parseFrontmatter(text: string): Record<string, unknown> {
  const split = splitFrontmatter(text)
  if (split === undefined) return {}
  const doc: unknown = load(split.head)
  return isRecord(doc) ? doc : {}
}
