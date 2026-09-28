import type { Locale } from './locale'

export type PluginLanguage = 'en_US' | 'zh_Hans' | 'ja_JP' | 'pt_BR'

export const getPluginLanguage = (locale: Locale): PluginLanguage => {
  switch (locale) {
    case 'zh-Hans':
      return 'zh_Hans'
    case 'ja-JP':
      return 'ja_JP'
    case 'pt-BR':
      return 'pt_BR'
    default:
      return 'en_US'
  }
}

export const getModelLanguage = (locale: Locale) => locale.replace('-', '_')

export const renderI18nObject = (
  obj: Record<string, string | null | undefined> | null | undefined,
  language: string,
) => {
  if (!obj) return ''
  if (obj?.[language]) return obj[language]
  if (obj?.en_US) return obj.en_US
  return Object.values(obj).find((value): value is string => !!value) || ''
}
