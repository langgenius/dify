import { zGetLoginQuery } from '@dify/contracts/api/console/login/zod.gen'
import { parseWebAppAddress } from '@/service/webapp-address'

type LoginSearchParams = Pick<URLSearchParams, 'get'>

export function isEndUserSignIn(searchParams: LoginSearchParams) {
  return searchParams.get('is_end_user') === '1' || searchParams.get('mode') === 'end_user'
}

/** Normalize the Webapp return URL at the Account login boundary. */
export function getEndUserLoginContext(searchParams: LoginSearchParams) {
  if (!isEndUserSignIn(searchParams)) return null
  const redirectUrl = searchParams.get('redirect_url')
  if (!redirectUrl) return null

  try {
    const url = new URL(redirectUrl, 'https://login-redirect.invalid')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    const appCode = searchParams.get('app_code') || parseWebAppAddress(url.pathname)?.code
    const input = zGetLoginQuery.safeParse({
      mode: 'end_user',
      app_code: appCode,
      redirect_url: redirectUrl,
      code_challenge: searchParams.get('code_challenge'),
    })
    return input.success ? input.data : null
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
  for (const key of ['app_code', 'code_challenge', 'code_challenge_method']) {
    const value = searchParams.get(key)
    if (value !== null) params.set(key, value)
  }
  return `/signin?${params.toString()}`
}

/** Navigation is accepted only from the Account API's validated handoff response. */
export function getAccountLoginCallbackUrl(raw: string | null | undefined) {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname.endsWith('/webapp-signin') &&
      url.searchParams.get('mode') === 'end_user' &&
      url.searchParams.get('login_code')
      ? url.href
      : null
  } catch {
    return null
  }
}
