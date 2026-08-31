import type { MarketplaceTemplate } from '@dify/contracts/marketplace'

export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'zh-Hans', label: 'Simplified Chinese', nativeLabel: '中文' },
  { value: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { value: 'other', label: 'Other', nativeLabel: 'Other' },
] as const

export function parseListParam(value?: string | string[]) {
  if (!value) return []
  const parts = Array.isArray(value) ? value : value.split(',')
  return parts.map((part) => part.trim()).filter(Boolean)
}

const getLanguagePrefix = (locale: string) => locale.toLowerCase().split(/[-_]/)[0] ?? ''

/**
 * Keeps the templates matching the requested locale's language. Templates
 * without language metadata are treated as language-agnostic and always kept.
 * When no template matches the requested language, the list explicitly falls
 * back to English templates (and finally to the unfiltered list) so locales
 * such as German render real content instead of an empty state.
 */
export function filterTemplatesForLocale<
  T extends Pick<MarketplaceTemplate, 'preferred_languages'>,
>(templates: T[], locale: string) {
  const requestedLanguage = getLanguagePrefix(locale)

  const filterByLanguage = (languagePrefix: string) =>
    templates.filter((template) => {
      const preferredLanguages = template.preferred_languages ?? []
      if (preferredLanguages.length === 0) return true
      return preferredLanguages.some((language) => getLanguagePrefix(language) === languagePrefix)
    })

  const requestedMatches = filterByLanguage(requestedLanguage)
  if (requestedMatches.length > 0) return requestedMatches

  const englishMatches = requestedLanguage === 'en' ? [] : filterByLanguage('en')
  if (englishMatches.length > 0) return englishMatches

  return templates
}

export function getTemplateCollectionText(value: Record<string, string>, locale: string) {
  const localeKey = locale.replace('-', '_')

  return value[localeKey] || value.en_US || Object.values(value)[0] || ''
}
