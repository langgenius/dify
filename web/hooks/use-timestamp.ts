'use client'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useCallback } from 'react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useIsSharePage } from '@/hooks/use-is-share-page'

dayjs.extend(utc)
dayjs.extend(timezone)

const useTimestamp = () => {
  const isSharePage = useIsSharePage()

  // 注：share 页面（chatbot/chat/completion/workflow）没有控制台登录态，
  // 不应请求 /account/profile，直接使用浏览器本地时区
  const { data: timezone } = useQuery({
    ...userProfileQueryOptions(),
    select: data => data.profile.timezone ?? undefined,
    enabled: !isSharePage,
  })

  const tz = isSharePage ? dayjs.tz.guess() : timezone

  const formatTime = useCallback((value: number, format: string) => {
    return dayjs.unix(value).tz(tz).format(format)
  }, [tz])

  const formatDate = useCallback((value: string, format: string) => {
    return dayjs(value).tz(tz).format(format)
  }, [tz])

  return { formatTime, formatDate }
}

export default useTimestamp
