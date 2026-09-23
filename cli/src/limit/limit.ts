import { newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export const LIMIT_MIN = 1
export const LIMIT_MAX = 200
export const LIMIT_DEFAULT = 20

const INTEGER_PATTERN = /^-?\d+$/

export function parseLimit(raw: string, source: string): number {
  if (!INTEGER_PATTERN.test(raw)) {
    throw newError(ErrorCode.UsageInvalidFlag, `${source}: ${JSON.stringify(raw)} is not a number`)
  }
  const n = Number(raw)
  if (n < LIMIT_MIN || n > LIMIT_MAX) {
    throw newError(
      ErrorCode.UsageInvalidFlag,
      `${source}: ${n} out of range [${LIMIT_MIN}..${LIMIT_MAX}]`,
    )
  }
  return n
}

const MAX_PAGES = 100

export type Page<T> = { readonly data: readonly T[]; readonly has_more: boolean }

/** Walks pages from 1 until has_more is false; MAX_PAGES caps a server that never says so. */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const env = await fetchPage(page)
    out.push(...env.data)
    if (!env.has_more) break
  }
  return out
}
