'use client'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useCallback } from 'react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { usePathname } from '@/next/navigation'

dayjs.extend(utc)
dayjs.extend(timezone)

const PUBLIC_WEBAPP_ROUTE_SEGMENTS = new Set(['agent', 'chat', 'chatbot', 'completion', 'workflow'])

const isPublicWebAppPath = (pathname: string | null) => {
  const segment = pathname?.split('/').find(Boolean)
  return segment ? PUBLIC_WEBAPP_ROUTE_SEGMENTS.has(segment) : false
}

const getBrowserTimezone = () => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

const useTimestamp = () => {
  const pathname = usePathname()
  const shouldUseAccountTimezone = !isPublicWebAppPath(pathname)
  const { data: accountTimezone } = useQuery({
    ...userProfileQueryOptions(),
    select: data => data.profile.timezone ?? undefined,
    enabled: shouldUseAccountTimezone,
  })
  const resolvedTimezone = accountTimezone ?? getBrowserTimezone()

  const formatTime = useCallback((value: number, format: string) => {
    return dayjs.unix(value).tz(resolvedTimezone).format(format)
  }, [resolvedTimezone])

  const formatDate = useCallback((value: string, format: string) => {
    return dayjs(value).tz(resolvedTimezone).format(format)
  }, [resolvedTimezone])

  return { formatTime, formatDate }
}

export default useTimestamp
