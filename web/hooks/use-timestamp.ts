'use client'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useCallback } from 'react'
import { userProfileQueryOptions } from '@/features/account-profile/client'

dayjs.extend(utc)
dayjs.extend(timezone)

type UseTimestampOptions = {
  timezone?: string
}

const getBrowserTimezone = () => {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

const useTimestamp = ({ timezone: timezoneOverride }: UseTimestampOptions = {}) => {
  const { data: accountTimezone } = useQuery({
    ...userProfileQueryOptions(),
    select: data => data.profile.timezone ?? undefined,
    enabled: timezoneOverride === undefined,
  })
  const resolvedTimezone = timezoneOverride ?? accountTimezone ?? getBrowserTimezone()

  const formatTime = useCallback((value: number, format: string) => {
    return dayjs.unix(value).tz(resolvedTimezone).format(format)
  }, [resolvedTimezone])

  const formatDate = useCallback((value: string, format: string) => {
    return dayjs(value).tz(resolvedTimezone).format(format)
  }, [resolvedTimezone])

  return { formatTime, formatDate }
}

export default useTimestamp
