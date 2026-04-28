import type { Template } from './types'
import { useMemo } from 'react'
import { useLocale } from '@/context/i18n'

export type TemplateLanguageBucket = 'en' | 'zh' | 'ja' | 'other'

/**
 * Map the user's system locale to one of the four template-language buckets
 * exposed by LANGUAGE_OPTIONS:
 *
 *   - en-* (e.g. en-US)        → 'en'
 *   - zh-Hans, zh-Hant, zh-*   → 'zh'
 *   - ja-* (e.g. ja-JP)        → 'ja'
 *   - anything else            → 'other'
 */
export function localeToLanguageBucket(locale: string): TemplateLanguageBucket {
  const lower = locale.toLowerCase()
  if (lower.startsWith('en'))
    return 'en'
  if (lower.startsWith('zh'))
    return 'zh'
  if (lower.startsWith('ja'))
    return 'ja'
  return 'other'
}

/**
 * Test whether a template's `preferred_languages` belong to a given bucket.
 *
 *   - 'en' bucket: at least one entry starts with 'en'
 *   - 'zh' bucket: at least one entry starts with 'zh'
 *   - 'ja' bucket: at least one entry starts with 'ja'
 *   - 'other' bucket: NONE of the entries start with en / zh / ja (this also
 *     matches templates that have an empty preferred_languages array)
 */
export function templateMatchesBucket(
  template: Pick<Template, 'preferred_languages'>,
  bucket: TemplateLanguageBucket,
): boolean {
  const langs = (template.preferred_languages || []).map(l => l.toLowerCase())

  if (bucket === 'other') {
    return !langs.some(l =>
      l.startsWith('en') || l.startsWith('zh') || l.startsWith('ja'),
    )
  }

  return langs.some(l => l.startsWith(bucket))
}

/**
 * Filter the templates list by the user's system language when they have
 * NOT manually selected a language in the "Filter by language" dropdown.
 *
 *   - When `hasManualFilter` is true, the server has already filtered the
 *     list, so the input is returned untouched.
 *   - Otherwise, the list is filtered client-side by the bucket derived
 *     from the current system locale. Changing the system locale causes
 *     this hook to re-compute and the visible list refreshes — but the
 *     templates `search/advanced` API is NOT refired (its queryKey doesn't
 *     depend on the locale).
 */
export function useTemplatesFilteredBySystemLanguage<
  T extends Pick<Template, 'preferred_languages'>,
>(
  templates: T[] | undefined,
  hasManualFilter: boolean,
): T[] | undefined {
  const locale = useLocale()
  return useMemo(() => {
    if (!templates)
      return undefined
    if (hasManualFilter)
      return templates
    const bucket = localeToLanguageBucket(locale)
    return templates.filter(t => templateMatchesBucket(t, bucket))
  }, [templates, hasManualFilter, locale])
}

/**
 * Same as `useTemplatesFilteredBySystemLanguage`, but for the collection →
 * templates map used by the curated-collections layout. Each collection's
 * template list is filtered independently.
 *
 * Empty collections (where every template was filtered out) are kept in
 * the map; the consumer can decide whether to hide them.
 */
export function useTemplateCollectionsMapFilteredBySystemLanguage<
  T extends Pick<Template, 'preferred_languages'>,
>(
  map: Record<string, T[]> | undefined,
  hasManualFilter: boolean,
): Record<string, T[]> | undefined {
  const locale = useLocale()
  return useMemo(() => {
    if (!map)
      return undefined
    if (hasManualFilter)
      return map
    const bucket = localeToLanguageBucket(locale)
    const filtered: Record<string, T[]> = {}
    for (const key of Object.keys(map))
      filtered[key] = map[key].filter(t => templateMatchesBucket(t, bucket))
    return filtered
  }, [map, hasManualFilter, locale])
}
