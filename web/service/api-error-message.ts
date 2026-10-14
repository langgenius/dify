import type { i18n as I18n } from 'i18next'

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/**
 * The viewer's translation of a backend error, looked up by its `code` in the `apiError`
 * namespace and interpolated from its `details`; `undefined` keeps the served `message`.
 * Requests rendered on the server keep the backend's English.
 */
export async function translateApiError(body: unknown, i18n?: I18n): Promise<string | undefined> {
  const data = asRecord(body)
  if (!data || typeof data.code !== 'string') return undefined
  i18n ??= await browserI18n()
  if (!i18n) return undefined
  const { code } = data
  try {
    await i18n.loadNamespaces('apiError')
    if (!i18n.exists(code, { ns: 'apiError' })) return undefined
    // The key comes from the response, so it cannot use a typed selector. `replace` keeps
    // served fields from being read as i18next options (`lng`, `count`, ...).
    const t = i18n.t as unknown as (key: string, options: Record<string, unknown>) => string
    return t(code, { ns: 'apiError', replace: asRecord(data.details) ?? {} })
  } catch {
    // A translation is an enhancement: failing to produce one never changes the error.
    return undefined
  }
}

// This module is reachable from server code (RSC, instrumentation), where react-i18next's
// React context cannot load, so it is imported only in the browser.
async function browserI18n(): Promise<I18n | undefined> {
  if (typeof window === 'undefined') return undefined
  const { getI18n } = await import('react-i18next')
  return getI18n()
}
