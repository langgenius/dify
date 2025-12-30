import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useCallback } from 'react'
import { useLocale } from '@/context/i18n'
import { localeMap } from '@/i18n-config/language'
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

export const useFormatTimeFromNow = () => {
  const locale = useLocale()
  const formatTimeFromNow = useCallback((time: number) => {
    const dayjsLocale = localeMap[locale] ?? 'en'
    return dayjs(time).locale(dayjsLocale).fromNow()
  }, [locale])

  return { formatTimeFromNow }
}
