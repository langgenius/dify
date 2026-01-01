import type { SearchParams } from '@/utils/search-params'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { firstSearchParam, searchParamsToString } from '@/utils/search-params'
import SignupClient from './signup-client'

type CookieStore = Awaited<ReturnType<typeof cookies>>

const hasConsoleAccessTokenCookie = (cookieStore: CookieStore) =>
  Boolean(cookieStore.get('access_token')?.value || cookieStore.get('__Host-access_token')?.value)

const shouldAutoRedirectToAceDataCloudOAuth = (cookieStore: CookieStore, searchParams: SearchParams) => {
  if (hasConsoleAccessTokenCookie(cookieStore))
    return false
  if (firstSearchParam(searchParams.no_acedatacloud_oauth) === '1')
    return false
  return true
}

const Signup = async ({ searchParams }: { searchParams?: SearchParams }) => {
  const safeSearchParams = searchParams || {}
  const cookieStore = await cookies()
  if (shouldAutoRedirectToAceDataCloudOAuth(cookieStore, safeSearchParams)) {
    const query = searchParamsToString(safeSearchParams)
    redirect(`/console/api/oauth/login/acedatacloud${query}`)
  }
  return <SignupClient />
}

export default Signup
