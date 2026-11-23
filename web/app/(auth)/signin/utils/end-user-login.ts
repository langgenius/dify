import { zGetLoginQuery } from '@dify/contracts/api/console/login/zod.gen'
import { resolveLoginRedirectTarget } from '@/utils/login-redirect'

const returnKeys = ['redirect_url', 'app_code', 'code_challenge', 'code_challenge_method'] as const

type LoginSearchParams = Pick<URLSearchParams, 'get'>

export function isEndUserSignIn(searchParams: LoginSearchParams) {
  const invitation = searchParams.get('invite_token')
  if (invitation && invitation !== 'null') return false

  return searchParams.get('is_end_user') === '1' || searchParams.get('mode') === 'end_user'
}

export function getEndUserLoginQuery(searchParams: LoginSearchParams) {
  const appCode = searchParams.get('app_code') ?? undefined
  const challenge = searchParams.get('code_challenge') ?? undefined
  const returnUrl = searchParams.get('redirect_url') ?? undefined
  if ((appCode !== undefined || challenge !== undefined) && (!appCode || !challenge || !returnUrl))
    return null

  const result = zGetLoginQuery.safeParse({
    mode: 'end_user',
    app_code: appCode,
    code_challenge: challenge,
    redirect_url: returnUrl,
  })
  return result.success ? result.data : null
}

export function getEndUserSignInUrl(searchParams: LoginSearchParams) {
  if (!isEndUserSignIn(searchParams)) return null

  const params = new URLSearchParams({ is_end_user: '1' })
  for (const key of returnKeys) {
    const value = searchParams.get(key)
    if (value !== null) params.set(key, value)
  }
  return `/signin?${params}`
}

/** Navigate only to the deployment origins after the server validates and resolves the target. */
export function resolveEndUserAccountRedirect(
  redirectUrl: string | null,
  webappUrl: string,
  consoleOrigin: string,
): string | null {
  try {
    const webappOrigin = new URL(webappUrl, consoleOrigin).origin
    const target =
      resolveLoginRedirectTarget(redirectUrl, {
        currentOrigin: webappOrigin,
        allowSameOriginAbsolute: true,
      }) ??
      resolveLoginRedirectTarget(redirectUrl, {
        currentOrigin: consoleOrigin,
        allowSameOriginAbsolute: true,
      })
    if (!target) return null

    // Same-origin deployments can have different Console and WebApp base paths.
    const url = new URL(target.href, webappOrigin)
    if (url.origin !== webappOrigin && url.origin !== consoleOrigin) return null
    return url.href
  } catch {
    return null
  }
}
