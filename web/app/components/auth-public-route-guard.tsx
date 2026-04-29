'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { resolvePostLoginRedirect } from '@/app/(auth)/_utils/post-login-redirect'
import RootLoading from '@/app/loading'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { isLegacyBase401, userProfileQueryOptions } from '@/service/use-common'

type AuthPublicRouteGuardProps = {
  children: ReactNode
}

const AUTHENTICATED_CONTINUATION_PATHS = new Set([
  '/signin/invite-settings',
])

const shouldRedirectAuthenticatedUser = (pathname: string) => {
  return !AUTHENTICATED_CONTINUATION_PATHS.has(pathname)
}

export const AuthPublicRouteGuard = ({
  children,
}: AuthPublicRouteGuardProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isPending, data: userResp, error: probeError } = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: err => !isLegacyBase401(err),
  })

  const isLoggedIn = !!userResp && !probeError
  const shouldRedirect = useMemo(() => {
    return isLoggedIn && shouldRedirectAuthenticatedUser(pathname)
  }, [isLoggedIn, pathname])

  useEffect(() => {
    if (!shouldRedirect)
      return

    router.replace(resolvePostLoginRedirect(searchParams) || '/apps')
  }, [router, searchParams, shouldRedirect])

  if (isPending || shouldRedirect)
    return <RootLoading />

  return children
}
