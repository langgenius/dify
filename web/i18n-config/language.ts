import type { DocLanguage } from '@/types/doc-paths'
import data from './languages'
import { supportedLocales } from './locale'

export type I18nText = Record<(typeof LanguagesSupported)[number], string>

export const languages = data.languages

// for compatibility
export type Locale = 'ja_JP' | 'zh_Hans' | 'en_US' | (typeof languages)[number]['value']

export const LanguagesSupported: Locale[] = supportedLocales

export const getLanguage = (locale: Locale): Locale => {
  // Plugin metadata supports only en_US, zh_Hans, ja_JP, and pt_BR; otherwise use en_US.
  if (['zh-Hans', 'ja-JP', 'pt-BR'].includes(locale)) return locale.replace('-', '_') as Locale

  return LanguagesSupported[0]!.replace('-', '_') as Locale
}

const DOC_LANGUAGE: Record<string, DocLanguage | undefined> = {
  'zh-Hans': 'zh',
  'ja-JP': 'ja',
  'en-US': 'en',
}

export type AccessControlTemplateLanguage = 'zh' | 'ja' | 'en'

const ACCESS_CONTROL_TEMPLATE_LANGUAGE: Record<string, AccessControlTemplateLanguage> = {
  'zh-Hans': 'zh',
  'ja-JP': 'ja',
  'en-US': 'en',
}

export const localeMap: Record<Locale, string> = {
  'en-US': 'en',
  en_US: 'en',
  'zh-Hans': 'zh-cn',
  zh_Hans: 'zh-cn',
  'zh-Hant': 'zh-tw',
  'pt-BR': 'pt-br',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ja-JP': 'ja',
  ja_JP: 'ja',
  'ko-KR': 'ko',
  'lo-LA': 'lo',
  'ru-RU': 'ru',
  'it-IT': 'it',
  'th-TH': 'th',
  'id-ID': 'id',
  'nl-NL': 'nl',
  'uk-UA': 'uk',
  'vi-VN': 'vi',
  'ro-RO': 'ro',
  'pl-PL': 'pl',
  'hi-IN': 'hi',
  'tr-TR': 'tr',
  'fa-IR': 'fa',
  'sl-SI': 'sl',
  'ar-TN': 'ar',
  'az-AZ': 'az',
}

export const getDocLanguage = (locale: string): DocLanguage => {
  return DOC_LANGUAGE[locale] || 'en'
}

export const getAccessControlTemplateLanguage = (locale: string): AccessControlTemplateLanguage => {
  return ACCESS_CONTROL_TEMPLATE_LANGUAGE[locale] || 'en'
}
