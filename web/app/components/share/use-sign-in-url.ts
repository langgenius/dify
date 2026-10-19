'use client'

import { usePathname, useSearchParams } from '@/next/navigation'

export default function useSignInUrl() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const currentPath = query ? `${pathname}?${query}` : pathname
  const signInParams = new URLSearchParams({ redirect_url: currentPath })

  return `/signin?${signInParams.toString()}`
}
