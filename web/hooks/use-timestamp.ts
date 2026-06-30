'use client'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useCallback } from 'react'
import { userProfileQueryOptions } from '@/features/account-profile/client'

dayjs.extend(utc)
dayjs.extend(timezone)

const useTimestamp = () => {
  const { data: timezone } = useQuery({
    ...userProfileQueryOptions(),
    select: data => data.profile.timezone ?? undefined,
  })

  const formatTime = useCallback((value: number, format: string) => {
    return dayjs.unix(value).tz(timezone).format(format)
  }, [timezone])

  const formatDate = useCallback((value: string, format: string) => {
    return dayjs(value).tz(timezone).format(format)
  }, [timezone])

  return { formatTime, formatDate }
}

export default useTimestamp
