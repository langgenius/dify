import type { ServerErrorBody } from './base'
import { parseHints } from '@/protocol/hint'

export function parseServerErrorBody(raw: string): ServerErrorBody | undefined {
  if (raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  if (record.code !== undefined && typeof record.code !== 'string') return undefined
  const message = typeof record.message === 'string' ? record.message : record.error
  if (typeof message !== 'string') return undefined
  const body = { ...record, message } as ServerErrorBody
  return record.hints === undefined ? body : { ...body, hints: parseHints(record.hints) }
}
