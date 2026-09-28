import type { Locale } from '@daypicker/react'
import { enUS } from '@daypicker/react/locale/en-US'
import { use, useDeferredValue } from 'react'

const localeLoaders: Record<string, () => Promise<Locale>> = {
  'zh-Hans': () => import('@daypicker/react/locale/zh-CN').then((module) => module.zhCN),
  'zh-Hant': () => import('@daypicker/react/locale/zh-TW').then((module) => module.zhTW),
  'ja-JP': () => import('@daypicker/react/locale/ja').then((module) => module.ja),
  'ko-KR': () => import('@daypicker/react/locale/ko').then((module) => module.ko),
  'de-DE': () => import('@daypicker/react/locale/de').then((module) => module.de),
  'fr-FR': () => import('@daypicker/react/locale/fr').then((module) => module.fr),
  'es-ES': () => import('@daypicker/react/locale/es').then((module) => module.es),
  'it-IT': () => import('@daypicker/react/locale/it').then((module) => module.it),
  'pt-BR': () => import('@daypicker/react/locale/pt-BR').then((module) => module.ptBR),
  'ru-RU': () => import('@daypicker/react/locale/ru').then((module) => module.ru),
  'uk-UA': () => import('@daypicker/react/locale/uk').then((module) => module.uk),
  'pl-PL': () => import('@daypicker/react/locale/pl').then((module) => module.pl),
  'nl-NL': () => import('@daypicker/react/locale/nl').then((module) => module.nl),
  'tr-TR': () => import('@daypicker/react/locale/tr').then((module) => module.tr),
  'vi-VN': () => import('@daypicker/react/locale/vi').then((module) => module.vi),
  'id-ID': () => import('@daypicker/react/locale/id').then((module) => module.id),
  'th-TH': () => import('@daypicker/react/locale/th').then((module) => module.th),
  'hi-IN': () => import('@daypicker/react/locale/hi').then((module) => module.hi),
  'ar-TN': () => import('@daypicker/react/locale/ar-TN').then((module) => module.arTN),
  'fa-IR': () => import('@daypicker/react/locale/fa-IR').then((module) => module.faIR),
  'ro-RO': () => import('@daypicker/react/locale/ro').then((module) => module.ro),
  'sl-SI': () => import('@daypicker/react/locale/sl').then((module) => module.sl),
  'az-AZ': () => import('@daypicker/react/locale/az').then((module) => module.az),
  'lo-LA': () => import('./lao-calendar-locale').then((module) => module.laoCalendarLocale),
}

// Locale modules are immutable and shared across picker instances, including suspended renders.
const localePromises = new Map<string, Promise<Locale>>()

function loadCalendarLocale(language: string): Promise<Locale> {
  let promise = localePromises.get(language)
  if (!promise) {
    promise = localeLoaders[language]!()
    localePromises.set(language, promise)
  }
  return promise
}

export function useCalendarLocale(language: string, overrides?: Partial<Locale>): Locale {
  const deferredLanguage = useDeferredValue(language)
  const locale = localeLoaders[deferredLanguage] ? use(loadCalendarLocale(deferredLanguage)) : enUS
  return overrides
    ? { ...locale, ...overrides, labels: { ...locale.labels, ...overrides.labels } }
    : locale
}
