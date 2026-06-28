'use client'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useCallback } from 'react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { usePathname } from '@/next/navigation'
import { isPublicWebAppRoute } from '@/utils/is-public-webapp-route'
import { getBrowserTimezone } from '@/utils/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

type UseTimestampOptions = {
  timezone?: string
}

const useTimestamp = ({ timezone: timezoneOverride }: UseTimestampOptions = {}) => {
  const pathname = usePathname()
  const isPublicWebApp = isPublicWebAppRoute(pathname)
  const shouldFetchAccountTimezone = timezoneOverride === undefined && !isPublicWebApp
  const { data: accountTimezone } = useQuery({
    ...userProfileQueryOptions(),
    select: data => data.profile.timezone ?? undefined,
    enabled: shouldFetchAccountTimezone,
  })
  const resolvedTimezone = timezoneOverride
    ?? (isPublicWebApp ? getBrowserTimezone() : accountTimezone)
    ?? getBrowserTimezone()

  const formatTime = useCallback((value: number, format: string) => {
    return dayjs.unix(value).tz(resolvedTimezone).format(format)
  }, [resolvedTimezone])

  const formatDate = useCallback((value: string, format: string) => {
    return dayjs(value).tz(resolvedTimezone).format(format)
  }, [resolvedTimezone])

  return { formatTime, formatDate }
}

export default useTimestamp
