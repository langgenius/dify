import dayjs from 'dayjs'
import { useCallback } from 'react'
import { useI18N } from '@/context/i18n'

export const useFormatTimeFromNow = () => {
  const { locale } = useI18N()
  const formatTimeFromNow = useCallback((time: number) => {
    return dayjs(time).locale(locale === 'zh-Hans' ? 'zh-cn' : locale).fromNow()
  }, [locale])

  return { formatTimeFromNow }
}
