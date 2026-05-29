import type { UserProfileWithMeta } from './client'
import type { AccountProfileResponse } from '@/contract/console/account'
import { queryOptions } from '@tanstack/react-query'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { SERVER_CONSOLE_API_PREFIX } from '@/config/server'
import { cookies, headers } from '@/next/headers'
import { consoleQuery } from '@/service/client'

const ACCOUNT_PROFILE_PATH = '/account/profile'

const withTrailingSlash = (value: string) => value.endsWith('/') ? value : `${value}/`
const withoutLeadingSlash = (value: string) => value.startsWith('/') ? value.slice(1) : value

const resolveAbsoluteUrlPrefix = (value: string) => {
  try {
    return new URL(value).toString()
  }
  catch {
    return null
  }
}

export const resolveServerConsoleApiUrl = (
  pathname: string,
  serverConsoleApiPrefix = SERVER_CONSOLE_API_PREFIX,
  publicApiPrefix = API_PREFIX,
) => {
  const requestPath = withoutLeadingSlash(pathname)
  const apiPrefix = serverConsoleApiPrefix || resolveAbsoluteUrlPrefix(publicApiPrefix)

  if (!apiPrefix)
    return null

  return new URL(requestPath, withTrailingSlash(apiPrefix)).toString()
}

const getServerRequestHeaders = async () => {
  const requestHeaders = await headers()
  const cookieStore = await cookies()
  const outgoingHeaders = new Headers({
    'Content-Type': 'application/json',
  })
  const cookie = requestHeaders.get('cookie')
  if (cookie)
    outgoingHeaders.set('cookie', cookie)
  const csrfToken = cookieStore.get(CSRF_COOKIE_NAME())?.value
  if (csrfToken)
    outgoingHeaders.set(CSRF_HEADER_NAME, csrfToken)
  return outgoingHeaders
}

export const serverUserProfileQueryOptions = () =>
  queryOptions<UserProfileWithMeta>({
    queryKey: consoleQuery.account.profile.get.queryKey(),
    queryFn: async () => {
      const profileUrl = resolveServerConsoleApiUrl(ACCOUNT_PROFILE_PATH)
      if (!profileUrl)
        throw new Error('Server account profile URL is not configured')

      const response = await fetch(profileUrl, {
        method: 'GET',
        headers: await getServerRequestHeaders(),
        cache: 'no-store',
      })

      if (!response.ok)
        throw response

      const profile: AccountProfileResponse = await response.clone().json()
      return {
        profile,
        meta: {
          currentVersion: response.headers.get('x-version'),
          currentEnv: response.headers.get('x-env'),
        },
      }
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
