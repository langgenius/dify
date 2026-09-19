import data from './languages'

export type Locale = (typeof data.languages)[number]['value']

export const defaultLocale = 'en-US' satisfies Locale
export const supportedLocales = data.languages
  .filter((language) => language.supported)
  .map((language) => language.value)

const legacyLocaleMap = new Map([
  ['en_US', 'en-US'],
  ['ja_JP', 'ja-JP'],
  ['zh_Hans', 'zh-Hans'],
])

export const canonicalizeLanguageTag = (language: string): string | undefined => {
  try {
    return Intl.getCanonicalLocales(legacyLocaleMap.get(language) ?? language)[0]
  } catch {
    return undefined
  }
}

export const normalizeLocale = (language: string): Locale => {
  const canonical = canonicalizeLanguageTag(language)
  return supportedLocales.find((locale) => locale === canonical) ?? defaultLocale
}
