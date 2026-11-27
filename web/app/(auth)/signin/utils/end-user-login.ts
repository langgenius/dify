import { zGetLoginQuery } from '@dify/contracts/api/console/login/zod.gen'
import { parseWebAppRoute, withWebAppPortalLoginCode } from '@/service/webapp-address'
import { basePath } from '@/utils/var'

type LoginSearchParams = Pick<URLSearchParams, 'get'>
const RELATIVE_REDIRECT_ORIGIN = 'https://login-redirect.invalid'
const UNSAFE_REDIRECT_CHARACTERS = /[\u0000-\u0020\u007F\\]/

export function isEndUserSignIn(searchParams: LoginSearchParams) {
  return searchParams.get('is_end_user') === '1' || searchParams.get('mode') === 'end_user'
}

/** Normalize the Webapp return URL at the Account login boundary. */
export function getEndUserLoginContext(searchParams: LoginSearchParams, webappUrl: string) {
  if (!isEndUserSignIn(searchParams)) return null
  const redirectUrl = searchParams.get('redirect_url')
  if (
    !redirectUrl?.startsWith('/') ||
    redirectUrl.startsWith('//') ||
    UNSAFE_REDIRECT_CHARACTERS.test(redirectUrl)
  )
    return null

  try {
    const url = new URL(redirectUrl, RELATIVE_REDIRECT_ORIGIN)
    const address = parseWebAppRoute(url.pathname)
    const appCode = searchParams.get('app_code') || address?.code
    const challenge = searchParams.get('code_challenge')
    // Deployment prefixes belong at the API boundary, outside the public sign-in URL.
    let apiRedirectUrl: string
    if (appCode) {
      if (!challenge || address?.kind !== 'default' || address.code !== appCode) return null
      const webappTarget = `${webappUrl.replace(/\/$/, '')}${redirectUrl}`
      apiRedirectUrl = webappTarget.startsWith('/') ? webappTarget : new URL(webappTarget).href
    } else {
      const portal = getPersonalPortalUrl(redirectUrl, '')
      if (!portal || (challenge !== null && portal.pathname !== '/my-apps')) return null
      const consolePrefix = challenge === null ? basePath.replace(/\/$/, '') : ''
      apiRedirectUrl = `${consolePrefix}${portal.pathname}${portal.search}${portal.hash}`
    }
    const input = zGetLoginQuery.safeParse({
      mode: 'end_user',
      app_code: appCode ?? undefined,
      redirect_url: apiRedirectUrl,
      code_challenge: challenge ?? undefined,
    })
    return input.success ? input.data : null
  } catch {
    return null
  }
}

function getPersonalPortalUrl(raw: string, prefix = basePath.replace(/\/$/, '')) {
  if (UNSAFE_REDIRECT_CHARACTERS.test(raw) || raw.startsWith('//')) return null
  try {
    // Relative portal targets also need to validate during server rendering.
    const origin = globalThis.location?.origin ?? RELATIVE_REDIRECT_ORIGIN
    const url = new URL(raw, origin)
    if (url.origin !== origin || url.username || url.password) return null
    if (!url.pathname.startsWith(`${prefix}/`)) return null
    const route = url.pathname.slice(prefix.length + 1)
    if (!/^(?:my-apps|connections(?:\/(?:[\w.~-]|%[0-9A-Fa-f]{2})+)?)$/.test(route)) return null
    if (['.', '..'].includes(decodeURIComponent(route.split('/').at(-1)!))) return null
    return url
  } catch {
    return null
  }
}

export function getEndUserAccountRedirectUrl(
  raw: string | null | undefined,
  context: ReturnType<typeof getEndUserLoginContext>,
  webappUrl: string,
  portalLoginCode?: string | null,
) {
  if (!raw || !context?.redirect_url) return null
  if (context.app_code) return getAccountLoginCallbackUrl(raw, context.redirect_url)
  if (UNSAFE_REDIRECT_CHARACTERS.test(raw) || raw.startsWith('//')) return null
  const consolePrefix = context.code_challenge ? '' : basePath.replace(/\/$/, '')
  const expected = getPersonalPortalUrl(context.redirect_url, consolePrefix)
  if (!expected) return null

  const portalPath = expected.pathname.slice(consolePrefix.length)
  try {
    const webappTarget = new URL(
      `${webappUrl.replace(/\/$/, '')}${portalPath}${expected.search}${expected.hash}`,
      expected.origin,
    )
    if (
      !['http:', 'https:'].includes(webappTarget.protocol) ||
      webappTarget.username ||
      webappTarget.password
    )
      return null

    const responseTarget = new URL(raw, expected.origin)
    if (context.code_challenge) {
      if (!portalLoginCode || responseTarget.href !== webappTarget.href) return null
      return withWebAppPortalLoginCode(webappTarget, portalLoginCode).href
    }
    // Legacy shared-cookie sessions can echo the Console path.
    if (responseTarget.href === expected.href || responseTarget.href === webappTarget.href)
      return webappTarget.href
  } catch {
    return null
  }
  return null
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
function getAccountLoginCallbackUrl(
  raw: string | null | undefined,
  expectedReturnUrl: string | null | undefined,
) {
  if (!raw || !expectedReturnUrl) return null
  if (UNSAFE_REDIRECT_CHARACTERS.test(raw) || raw.startsWith('//')) return null
  try {
    const origin = globalThis.location?.origin ?? RELATIVE_REDIRECT_ORIGIN
    const url = new URL(raw, origin)
    const target = new URL(expectedReturnUrl, origin)
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
