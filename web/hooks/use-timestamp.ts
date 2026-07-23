'use client'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useCallback } from 'react'
import { useLocale } from '@/context/i18n'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { formatToLocalTime } from '@/utils/format'

dayjs.extend(utc)
dayjs.extend(timezone)

type UseTimestampOptions = {
  timezone?: string
}

const getBrowserTimezone = () => {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

const getIntlLocale = (locale: string) => locale.replace('_', '-')

const useTimestamp = ({ timezone: timezoneOverride }: UseTimestampOptions = {}) => {
  const locale = useLocale()
  const { data: accountTimezone } = useQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.timezone ?? undefined,
    enabled: timezoneOverride === undefined,
  })
  const resolvedTimezone = timezoneOverride ?? accountTimezone ?? getBrowserTimezone()

  const formatTime = useCallback(
    (value: number, format: string) => {
      return formatToLocalTime(dayjs.unix(value).tz(resolvedTimezone), locale, format)
    },
    [locale, resolvedTimezone],
  )

  const formatDate = useCallback(
    (value: string, format: string) => {
      return formatToLocalTime(dayjs(value).tz(resolvedTimezone), locale, format)
    },
    [locale, resolvedTimezone],
  )

  const formatMonthDay = useCallback(
    (value: number) => {
      return new Intl.DateTimeFormat(getIntlLocale(locale), {
        month: 'short',
        day: 'numeric',
        timeZone: resolvedTimezone,
      }).format(value * 1000)
    },
    [locale, resolvedTimezone],
  )

  return { formatTime, formatDate, formatMonthDay }
}

export default useTimestamp
