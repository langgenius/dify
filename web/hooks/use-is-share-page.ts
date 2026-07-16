'use client'
import { useMemo } from 'react'
import { usePathname } from '@/next/navigation'
import { basePath } from '@/utils/var'

const SHARE_PATH_PREFIXES = ['/chatbot', '/chat', '/completion', '/workflow', '/webapp-signin', '/agent']

/**
 * 判断当前页面是否为 share（公开分享）页面。
 * share 页面不依赖控制台登录态，不应发起控制台 API 请求。
 */
export function useIsSharePage(): boolean {
  const pathname = usePathname()
  return useMemo(
    () => SHARE_PATH_PREFIXES.some(prefix => pathname.startsWith(`${basePath}${prefix}`)),
    [pathname],
  )
}
