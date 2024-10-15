'use client'
import { useCallback, useEffect, useRef } from 'react'
import { jwtDecode } from 'jwt-decode'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { useRouter } from 'next/navigation'
import type { CommonResponse } from '@/models/common'
import { fetchNewToken } from '@/service/common'
import { fetchWithRetry } from '@/utils'

dayjs.extend(utc)

const useRefreshToken = () => {
  const router = useRouter()
  const timer = useRef<NodeJS.Timeout>()
  const advanceTime = useRef<number>(5 * 60 * 1000)

  const getExpireTime = useCallback((token: string) => {
    if (!token)
      return 0
    const decoded = jwtDecode(token)
    return (decoded.exp || 0) * 1000
  }, [])

  const getCurrentTimeStamp = useCallback(() => {
    return dayjs.utc().valueOf()
  }, [])

  const handleError = useCallback(() => {
    localStorage?.removeItem('is_refreshing')
    localStorage?.removeItem('console_token')
    localStorage?.removeItem('refresh_token')
    router.replace('/signin')
  }, [])

  const getNewAccessToken = useCallback(async () => {
    const currentAccessToken = localStorage?.getItem('console_token')
    const currentRefreshToken = localStorage?.getItem('refresh_token')
    if (!currentAccessToken || !currentRefreshToken) {
      handleError()
      return new Error('No access token or refresh token found')
    }
    if (localStorage?.getItem('is_refreshing') === '1') {
      timer.current = setTimeout(() => {
        getNewAccessToken()
      }, 1000)
      return null
    }
    const currentTokenExpireTime = getExpireTime(currentAccessToken)
    if (getCurrentTimeStamp() + advanceTime.current > currentTokenExpireTime) {
      localStorage?.setItem('is_refreshing', '1')
      const [e, res] = await fetchWithRetry(fetchNewToken({
        body: { refresh_token: currentRefreshToken },
      }) as Promise<CommonResponse & { data: { access_token: string; refresh_token: string } }>)
      if (e) {
        handleError()
        return e
      }
      const { access_token, refresh_token } = res.data
      localStorage?.setItem('is_refreshing', '0')
      localStorage?.setItem('console_token', access_token)
      localStorage?.setItem('refresh_token', refresh_token)
      const newTokenExpireTime = getExpireTime(access_token)
      timer.current = setTimeout(() => {
        getNewAccessToken()
      }, newTokenExpireTime - advanceTime.current - getCurrentTimeStamp())
    }
    else {
      const newTokenExpireTime = getExpireTime(currentAccessToken)
      timer.current = setTimeout(() => {
        getNewAccessToken()
      }, newTokenExpireTime - advanceTime.current - getCurrentTimeStamp())
    }
    return null
  }, [getExpireTime, getCurrentTimeStamp, handleError])

  useEffect(() => {
    return () => {
      clearTimeout(timer.current)
      localStorage?.removeItem('is_refreshing')
    }
  }, [])

  return {
    getNewAccessToken,
  }
}

export default useRefreshToken
