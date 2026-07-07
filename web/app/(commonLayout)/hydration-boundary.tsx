import type { ReactNode } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { getQueryClientServer } from '@/context/query-client-server'
import { serverUserProfileQueryOptions } from '@/features/account-profile/server'
import { serverSystemFeaturesQueryOptions } from '@/features/system-features/server'
import { headers } from '@/next/headers'
import { redirect } from '@/next/navigation'
import { getServerConsoleClientContext, resolveServerConsoleApiUrl, serverConsoleQuery } from '@/service/server'
import { basePath } from '@/utils/var'

const CURRENT_PATHNAME_HEADER = 'x-dify-pathname'
const CURRENT_SEARCH_HEADER = 'x-dify-search'
const ACCOUNT_PROFILE_PATH = '/account/profile'
const AUTH_REFRESH_PATH = '/auth/refresh'

type ConsoleErrorPayload = {
  code?: string
}

const isConsoleErrorPayload = (value: unknown): value is ConsoleErrorPayload =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const parseConsoleErrorPayload = async (error: Response): Promise<ConsoleErrorPayload | null> => {
  try {
    const payload: unknown = await error.clone().json()
    return isConsoleErrorPayload(payload) ? payload : null
  }
  catch {
    return null
  }
}

const getCurrentPath = async () => {
  const requestHeaders = await headers()
  const pathname = requestHeaders.get(CURRENT_PATHNAME_HEADER) || `${basePath}/`
  const search = requestHeaders.get(CURRENT_SEARCH_HEADER) || ''
  return `${pathname}${search}`
}

const redirectToAuthRefresh = async () => {
  const currentPath = await getCurrentPath()
  redirect(`${basePath}${AUTH_REFRESH_PATH}?redirect_url=${encodeURIComponent(currentPath)}`)
}

const handleProfileError = async (error: unknown) => {
  if (!(error instanceof Response))
    throw error

  const errorData = await parseConsoleErrorPayload(error)
  if (errorData?.code === 'not_setup')
    redirect(`${basePath}/install`)
  if (errorData?.code === 'not_init_validated')
    redirect(`${basePath}/init`)
  if (error.status === 401)
    await redirectToAuthRefresh()

  throw error
}

export async function CommonLayoutHydrationBoundary({ children }: { children: ReactNode }) {
  const queryClient = getQueryClientServer()
  const accountProfileUrl = resolveServerConsoleApiUrl(ACCOUNT_PROFILE_PATH)

  if (!accountProfileUrl) {
    return (
      <HydrationBoundary state={dehydrate(queryClient)}>
        {children}
      </HydrationBoundary>
    )
  }

  try {
    const context = await getServerConsoleClientContext()

    await Promise.all([
      queryClient.fetchQuery(serverUserProfileQueryOptions()),
      queryClient.prefetchQuery(serverSystemFeaturesQueryOptions()),
      queryClient.prefetchQuery(serverConsoleQuery.workspaces.current.post.queryOptions({
        context,
        retry: false,
      })),
    ])
  }
  catch (error) {
    await handleProfileError(error)
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  )
}
