import type { i18n as I18n } from 'i18next'
import { getClientI18n } from '@/i18n/client-instance'

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/**
 * The translation of a backend error body, looked up by its `code` in the `apiError`
 * namespace and interpolated from its `details`; `undefined` when the code has none.
 */
export function translateApiError(body: unknown, i18n: I18n): string | undefined {
  const data = asRecord(body)
  if (!data || typeof data.code !== 'string') return undefined
  if (!i18n.exists(data.code, { ns: 'apiError' })) return undefined
  // The key comes from the response, so it cannot use a typed selector. `replace` keeps
  // served fields from being read as i18next options (`lng`, `count`, ...).
  const t = i18n.t as unknown as (key: string, options: Record<string, unknown>) => string
  return t(data.code, { ns: 'apiError', replace: asRecord(data.details) ?? {} })
}

/** `translateApiError` with the browser's i18n, loading `apiError` first; `undefined` on the server. */
export async function translateRequestError(body: unknown): Promise<string | undefined> {
  const i18n = getClientI18n()
  if (!i18n || typeof asRecord(body)?.code !== 'string') return undefined
  try {
    await i18n.loadNamespaces('apiError')
    return translateApiError(body, i18n)
  } catch {
    // A translation is an enhancement: failing to produce one keeps the served message.
    return undefined
  }
}
