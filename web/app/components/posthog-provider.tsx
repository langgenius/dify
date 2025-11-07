'use client'

import type { FC } from 'react'
import React, { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'

const PostHogProvider: FC = () => {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    posthog.init('phc_Nqsm7RqSX7ZUbH9C47ZRfiUsVBCiLZIrapbWjHAYTBV', {
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'identified_only', // 为已识别用户创建 profile 并存储 UTM
      autocapture: true, // 自动捕获用户交互
      capture_exceptions: true, // 捕获异常
    })

      // 初始化后，确保捕获 UTM 参数
      // PostHog 会自动将首次访问的 UTM 保存为 Initial UTM
    if (typeof window !== 'undefined' && window.location.search) {
      const urlParams = new URLSearchParams(window.location.search)
      const utmParams: Record<string, string> = {}

        // 提取所有 UTM 参数
      const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
      utmKeys.forEach((key) => {
        const value = urlParams.get(key)
        if (value)
          utmParams[key] = value
      })

        // 如果有 UTM 参数，注册为持久属性
      if (Object.keys(utmParams).length > 0)
        posthog.register(utmParams)
    }
  }, [])

  // 追踪页面浏览
  useEffect(() => {
    if (pathname && posthog.__loaded) {
      let url = window.origin + pathname
      if (searchParams.toString())
        url = `${url}?${searchParams.toString()}`

      posthog.capture('$pageview', {
        $current_url: url,
      })
    }
  }, [pathname, searchParams])

  // This is a client component that renders nothing
  return null
}

export default React.memo(PostHogProvider)
