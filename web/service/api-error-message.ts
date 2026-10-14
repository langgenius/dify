import type { i18n as I18n } from 'i18next'
import { getI18n } from 'react-i18next'

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/**
 * The viewer's translation of a backend error, looked up by its `code` in the `apiError`
 * namespace and interpolated from its `details`; `undefined` keeps the served `message`.
 * Requests rendered on the server keep the backend's English.
 */
export async function translateApiError(
  body: unknown,
  i18n: I18n | undefined = typeof window === 'undefined' ? undefined : getI18n(),
): Promise<string | undefined> {
  const data = asRecord(body)
  if (!i18n || !data || typeof data.code !== 'string') return undefined
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
