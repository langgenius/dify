import { parseWebAppAddress } from '@/service/webapp-address'

type LoginSearchParams = Pick<URLSearchParams, 'get'>

export function isEndUserSignIn(searchParams: LoginSearchParams) {
  return searchParams.get('is_end_user') === '1'
}

/** Normalize the Webapp return URL at the Account login boundary. */
export function getEndUserLoginContext(searchParams: LoginSearchParams) {
  if (!isEndUserSignIn(searchParams)) return null
  const redirectUrl = searchParams.get('redirect_url')
  if (!redirectUrl) return null

  try {
    const url = new URL(redirectUrl, 'https://login-redirect.invalid')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const address = parseWebAppAddress(url.pathname)
    if (!address) return null
    return { mode: 'end_user' as const, app_code: address.code, redirect_url: redirectUrl }
  } catch {
    return null
  }
}

/** Preserve the End User return context across external login redirects. */
export function getEndUserSignInUrl(searchParams: LoginSearchParams) {
  if (!isEndUserSignIn(searchParams)) return null

  const params = new URLSearchParams({ is_end_user: '1' })
  const redirectUrl = searchParams.get('redirect_url')
  if (redirectUrl !== null) params.set('redirect_url', redirectUrl)
  return `/signin?${params.toString()}`
}
