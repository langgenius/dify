import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useCallback } from 'react'
import { useI18N } from '@/context/i18n'
import type { Locale } from '@/i18n-config'
import 'dayjs/locale/de'
import 'dayjs/locale/es'
import 'dayjs/locale/fa'
import 'dayjs/locale/fr'
import 'dayjs/locale/hi'
import 'dayjs/locale/id'
import 'dayjs/locale/it'
import 'dayjs/locale/ja'
import 'dayjs/locale/ko'
import 'dayjs/locale/pl'
import 'dayjs/locale/pt-br'
import 'dayjs/locale/ro'
import 'dayjs/locale/ru'
import 'dayjs/locale/sl'
import 'dayjs/locale/th'
import 'dayjs/locale/tr'
import 'dayjs/locale/uk'
import 'dayjs/locale/vi'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'

dayjs.extend(relativeTime)

const localeMap: Record<Locale, string> = {
  'en-US': 'en',
  'zh-Hans': 'zh-cn',
  'zh-Hant': 'zh-tw',
  'pt-BR': 'pt-br',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'ru-RU': 'ru',
  'it-IT': 'it',
  'th-TH': 'th',
  'id-ID': 'id',
  'uk-UA': 'uk',
  'vi-VN': 'vi',
  'ro-RO': 'ro',
  'pl-PL': 'pl',
  'hi-IN': 'hi',
  'tr-TR': 'tr',
  'fa-IR': 'fa',
  'sl-SI': 'sl',
}

export const useFormatTimeFromNow = () => {
  const { locale } = useI18N()
  const formatTimeFromNow = useCallback((time: number) => {
    const dayjsLocale = localeMap[locale] ?? 'en'
    return dayjs(time).locale(dayjsLocale).fromNow()
  }, [locale])

  return { formatTimeFromNow }
}
