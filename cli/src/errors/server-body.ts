import type { ServerErrorBody } from './base'
import { parseHints } from '@/protocol/hint'

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function parseServerErrorBody(raw: string): ServerErrorBody | undefined {
  if (raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const { hint, hints, ...record } = parsed as Record<string, unknown>
  if (record.code !== undefined && typeof record.code !== 'string') return undefined
  const message = nonEmptyString(record.message) ?? nonEmptyString(record.error)
  if (message === undefined) return undefined
  const body: Record<string, unknown> = { ...record, message }
  const cleanHint = nonEmptyString(hint)
  if (cleanHint !== undefined) body.hint = cleanHint
  if (hints !== undefined) body.hints = parseHints(hints)
  return body as ServerErrorBody
}
