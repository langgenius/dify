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

/** Move the Account API's validated handoff directly onto its requested Web App page. */
export function getAccountLoginCallbackUrl(
  raw: string | null | undefined,
  expectedReturnUrl: string | null | undefined,
) {
  if (!raw || !expectedReturnUrl) return null
  try {
    const url = new URL(raw)
    const target = new URL(expectedReturnUrl, url.origin)
    const code = url.searchParams.get('login_code')
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      target.username ||
      target.password ||
      !url.pathname.endsWith('/webapp-signin') ||
      target.origin !== url.origin ||
      url.searchParams.get('redirect_url') !== expectedReturnUrl ||
      url.searchParams.get('mode') !== 'end_user' ||
      !code
    )
      return null
    // The API validates the exact App target; its Web prefix is independent of Account's base path.
    const webPrefix = url.pathname.slice(0, -'/webapp-signin'.length)
    if (!target.pathname.startsWith(`${webPrefix}/`)) return null
    target.searchParams.set('mode', 'end_user')
    target.searchParams.set('login_code', code)
    target.searchParams.set('redirect_url', expectedReturnUrl)
    return target.href
  } catch {
    return null
  }
}
