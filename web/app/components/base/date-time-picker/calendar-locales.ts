import type { Locale } from '@daypicker/react'
import { enUS } from '@daypicker/react/locale/en-US'
import { useEffect, useState } from 'react'

// DayPicker has no Lao locale. Keep the application fallback here.
const lo: Locale = {
  ...enUS,
  code: 'lo-LA',
  labels: {
    labelDayButton: (date) =>
      new Intl.DateTimeFormat('lo-LA', { dateStyle: 'full', timeZone: 'UTC' }).format(date),
    labelGrid: (date) =>
      new Intl.DateTimeFormat('lo-LA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        date,
      ),
    labelWeekday: (date) =>
      new Intl.DateTimeFormat('lo-LA', { weekday: 'long', timeZone: 'UTC' }).format(date),
  },
  localize: {
    ...enUS.localize,
    month: (month) =>
      new Intl.DateTimeFormat('lo-LA', { month: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2025, month, 1)),
      ),
    day: (day) =>
      new Intl.DateTimeFormat('lo-LA', { weekday: 'short', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2025, 0, 5 + day)),
      ),
  },
}

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
}

const loadedLocales = new Map<string, Locale>([
  ['en-US', enUS],
  ['lo-LA', lo],
])

export function useCalendarLocale(language: string, overrides?: Partial<Locale>): Locale {
  const key = Object.hasOwn(localeLoaders, language) || language === 'lo-LA' ? language : 'en-US'
  const [loaded, setLoaded] = useState<{ language: string; locale: Locale }>()
  const cachedLocale = loadedLocales.get(key)
  const locale =
    cachedLocale ?? (loaded?.language === key ? loaded.locale : { ...enUS, code: language })

  // Locale modules are shared resources; keep picker values and open state mounted while they load.
  useEffect(() => {
    if (cachedLocale) return
    let active = true
    const cached = loadedLocales.get(key)
    const request = cached ? Promise.resolve(cached) : localeLoaders[key]!()
    void request.then(
      (locale) => {
        loadedLocales.set(key, locale)
        if (active) setLoaded({ language: key, locale })
      },
      () => {
        if (active) setLoaded({ language: key, locale: enUS })
      },
    )
    return () => {
      active = false
    }
  }, [key, cachedLocale])

  return overrides
    ? { ...locale, ...overrides, labels: { ...locale.labels, ...overrides.labels } }
    : locale
}
