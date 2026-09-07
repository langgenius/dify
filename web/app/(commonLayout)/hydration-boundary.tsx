import type { ReactNode } from 'react'
import { dehydrate, HydrationBoundary, noop } from '@tanstack/react-query'
import { getQueryClient } from '@/app/get-query-client'
import { serverUserProfileQueryOptions } from '@/features/account-profile/server'
import { REFRESH_TOKEN_COOKIE_NAME } from '@/config'
import { headers } from '@/next/headers'
import { redirect } from '@/next/navigation'
import {
  getServerConsoleClientContext,
  resolveServerConsoleApiUrl,
  serverConsoleQuery,
} from '@/service/server'

const CURRENT_PATHNAME_HEADER = 'x-dify-pathname'
const CURRENT_SEARCH_HEADER = 'x-dify-search'
const ACCOUNT_PROFILE_PATH = '/account/profile'
const AUTH_REFRESH_PATH = '/auth/refresh'
const SIGNIN_PATH = '/signin'

type ConsoleErrorPayload = {
  code?: string
}

const isConsoleErrorPayload = (value: unknown): value is ConsoleErrorPayload =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const parseConsoleErrorPayload = async (error: Response): Promise<ConsoleErrorPayload | null> => {
  try {
    const payload: unknown = await error.clone().json()
    return isConsoleErrorPayload(payload) ? payload : null
  } catch {
    return null
  }
}

const getCurrentPath = async () => {
  const requestHeaders = await headers()
  const pathname = requestHeaders.get(CURRENT_PATHNAME_HEADER) || '/'
  const search = requestHeaders.get(CURRENT_SEARCH_HEADER) || ''
  return `${pathname}${search}`
}

// `/auth/refresh` is a Route Handler, so it can only answer with a bare 3xx. During an
// RSC navigation the client router cannot settle on that, and it retries this request
// forever (the flashing sign-in loop). Only go there when a refresh token actually
// exists to be exchanged; otherwise redirect straight to the sign-in *page*, which
// returns an RSC payload the router can commit.
const redirectToAuthRefresh = async () => {
  const currentPath = await getCurrentPath()
  const target = encodeURIComponent(currentPath)
  const { cookies } = await import('@/next/headers')
  const cookieStore = await cookies()

  if (!cookieStore.get(REFRESH_TOKEN_COOKIE_NAME())?.value)
    redirect(`${SIGNIN_PATH}?redirect_url=${target}`)

  redirect(`${AUTH_REFRESH_PATH}?redirect_url=${target}`)
}

const handleProfileError = async (error: unknown) => {
  if (!(error instanceof Response)) throw error

  const errorData = await parseConsoleErrorPayload(error)
  if (errorData?.code === 'not_setup') redirect('/install')
  if (errorData?.code === 'not_init_validated') redirect('/init')
  if (error.status === 401) await redirectToAuthRefresh()

  throw error
}

export async function CommonLayoutHydrationBoundary({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient()
  const accountProfileUrl = resolveServerConsoleApiUrl(ACCOUNT_PROFILE_PATH)

  if (accountProfileUrl) {
    try {
      const context = await getServerConsoleClientContext()

      await Promise.all([
        queryClient.query(serverUserProfileQueryOptions()),
        queryClient
          .query(
            serverConsoleQuery.workspaces.current.summary.get.queryOptions({
              context,
              retry: false,
            }),
          )
          .catch(noop),
        queryClient
          .query(
            serverConsoleQuery.workspaces.current.rbac.myPermissions.get.queryOptions({
              context,
              retry: false,
            }),
          )
          .catch(noop),
      ])
    } catch (error) {
      await handleProfileError(error)
    }
  }

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>
}
