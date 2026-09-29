import type { Locale } from '@daypicker/react'
import { arTN } from '@daypicker/react/locale/ar-TN'
import { az } from '@daypicker/react/locale/az'
import { de } from '@daypicker/react/locale/de'
import { enUS } from '@daypicker/react/locale/en-US'
import { es } from '@daypicker/react/locale/es'
import { faIR } from '@daypicker/react/locale/fa-IR'
import { fr } from '@daypicker/react/locale/fr'
import { hi } from '@daypicker/react/locale/hi'
import { id } from '@daypicker/react/locale/id'
import { it } from '@daypicker/react/locale/it'
import { ja } from '@daypicker/react/locale/ja'
import { ko } from '@daypicker/react/locale/ko'
import { nl } from '@daypicker/react/locale/nl'
import { pl } from '@daypicker/react/locale/pl'
import { ptBR } from '@daypicker/react/locale/pt-BR'
import { ro } from '@daypicker/react/locale/ro'
import { ru } from '@daypicker/react/locale/ru'
import { sl } from '@daypicker/react/locale/sl'
import { th } from '@daypicker/react/locale/th'
import { tr } from '@daypicker/react/locale/tr'
import { uk } from '@daypicker/react/locale/uk'
import { vi } from '@daypicker/react/locale/vi'
import { zhCN } from '@daypicker/react/locale/zh-CN'
import { zhTW } from '@daypicker/react/locale/zh-TW'

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

const calendarLocales: Record<string, Locale> = {
  'en-US': enUS,
  'zh-Hans': zhCN,
  'zh-Hant': zhTW,
  'ja-JP': ja,
  'ko-KR': ko,
  'de-DE': de,
  'fr-FR': fr,
  'es-ES': es,
  'it-IT': it,
  'pt-BR': ptBR,
  'ru-RU': ru,
  'uk-UA': uk,
  'pl-PL': pl,
  'nl-NL': nl,
  'tr-TR': tr,
  'vi-VN': vi,
  'id-ID': id,
  'th-TH': th,
  'hi-IN': hi,
  'ar-TN': arTN,
  'fa-IR': faIR,
  'ro-RO': ro,
  'sl-SI': sl,
  'az-AZ': az,
  'lo-LA': lo,
}

export function getCalendarLocale(language: string, overrides?: Partial<Locale>): Locale {
  const locale = calendarLocales[language] ?? enUS
  return overrides
    ? { ...locale, ...overrides, labels: { ...locale.labels, ...overrides.labels } }
    : locale
}
