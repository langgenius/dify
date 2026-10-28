'use client'

import type { PropsWithChildren } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useWebAppStore } from '@/context/web-app-context'
import { usePathname, useSearchParams } from '@/next/navigation'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import { isWebAppAccountCallback } from '@/service/webapp/login'
import AccountLoginCallback from './account-login-callback'

const getServerSession = () => 0

function SessionContent({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === 'webapp' ||
        (query.queryKey[0] === 'access-control' &&
          query.queryKey[1] === 'user-can-access-app' &&
          query.queryKey[4] === false),
    }
    // Stop observers from an earlier account before a new App session can mount.
    void queryClient.cancelQueries(filters).then(() => {
      if (cancelled) return
      queryClient.removeQueries(filters)
      useWebAppStore.setState({
        appInfo: null,
        appParams: null,
        appMeta: null,
        userCanAccessApp: false,
      })
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [queryClient])

  return ready ? children : <LoadingPlaceholder />
}

export default function AuthSessionBoundary({ children }: PropsWithChildren) {
  const pathname = usePathname()
  const params = useSearchParams()
  const session = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    getServerSession,
  )
  return isWebAppAccountCallback(pathname, params) ? (
    <AccountLoginCallback
      key={`${pathname}:${params.get('redirect_url')}:${params.get('login_code')}`}
    />
  ) : (
    <SessionContent key={session}>{children}</SessionContent>
  )
}
