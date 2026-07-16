'use client'
import { useMemo } from 'react'
import { usePathname } from '@/next/navigation'
import { basePath } from '@/utils/var'

const SHARE_PATH_PREFIXES = ['/chatbot', '/chat', '/completion', '/workflow', '/webapp-signin', '/agent']

/**
 * Detect whether the current page is a share (public) page.
 * Share pages have no console session and must not issue console API requests.
 */
export function useIsSharePage(): boolean {
  const pathname = usePathname()
  return useMemo(
    () => SHARE_PATH_PREFIXES.some(prefix => pathname.startsWith(`${basePath}${prefix}`)),
    [pathname],
  )
}
