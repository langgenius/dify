import type { MarketplaceTemplate } from '@dify/contracts/marketplace'

type TemplateLanguageFamily = 'en' | 'ja' | 'other' | 'zh'

function getTemplateLanguageFamily(locale: string): TemplateLanguageFamily {
  const normalizedLocale = locale.toLowerCase()

  if (normalizedLocale.startsWith('en')) return 'en'
  if (normalizedLocale.startsWith('zh')) return 'zh'
  if (normalizedLocale.startsWith('ja')) return 'ja'

  return 'other'
}

export function filterTemplatesForLocale<
  T extends Pick<MarketplaceTemplate, 'preferred_languages'>,
>(templates: T[], locale: string) {
  const languageFamily = getTemplateLanguageFamily(locale)

  return templates.filter((template) => {
    const preferredLanguages = (template.preferred_languages ?? []).map((language) =>
      language.toLowerCase(),
    )

    if (languageFamily === 'other') {
      return !preferredLanguages.some(
        (language) =>
          language.startsWith('en') || language.startsWith('zh') || language.startsWith('ja'),
      )
    }

    return preferredLanguages.some((language) => language.startsWith(languageFamily))
  })
}

export function getTemplateCollectionText(value: Record<string, string>, locale: string) {
  const localeKey = locale.replace('-', '_')

  return value[localeKey] || value.en_US || Object.values(value)[0] || ''
}
