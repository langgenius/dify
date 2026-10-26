import type { WebAppAddress } from '@/service/webapp-address'
import type { LoginRedirectTarget } from '@/utils/login-redirect'
import { parseWebAppAddress } from '@/service/webapp-address'
import { resolveLoginRedirectTarget } from '@/utils/login-redirect'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'

const INTERNAL_PATH_PARSE_BASE = 'https://login-redirect.invalid'

export type WebAppLoginRedirect = {
  appCode: string
  address: WebAppAddress
  target: LoginRedirectTarget
}

function addBasePathOnce(href: string, basePath: string) {
  const normalizedBasePath = basePath === '/' ? '' : basePath.replace(/\/+$/, '')
  if (!normalizedBasePath) return href

  const url = new URL(href, INTERNAL_PATH_PARSE_BASE)
  if (url.pathname === normalizedBasePath || url.pathname.startsWith(`${normalizedBasePath}/`))
    return href

  return `${normalizedBasePath}${url.pathname}${url.search}${url.hash}`
}

export function navigateAfterWebAppLogin(
  loginRedirect: WebAppLoginRedirect,
  routerReplace: (href: string) => void,
  basePath: string,
) {
  if (loginRedirect.address.kind === 'environment') {
    const href =
      loginRedirect.target.kind === 'internal'
        ? addBasePathOnce(loginRedirect.target.href, basePath)
        : loginRedirect.target.href
    globalThis.location.replace(href)
    return
  }

  replaceLoginRedirect(loginRedirect.target, routerReplace, basePath)
}

export function isWebAppSigninPath(pathname: string): boolean {
  let candidate = pathname

  for (let decodeCount = 0; decodeCount <= 2; decodeCount += 1) {
    if (candidate.split('/').some((segment) => segment === 'webapp-signin')) return true

    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return false
    }
  }

  return false
}

export function resolveWebAppLoginRedirect(
  raw: string | null,
  currentOrigin?: string,
): WebAppLoginRedirect | null {
  const target = resolveLoginRedirectTarget(raw, {
    allowSameOriginAbsolute: Boolean(currentOrigin),
    currentOrigin,
  })
  if (!target) return null

  try {
    const url = new URL(target.href, currentOrigin || INTERNAL_PATH_PARSE_BASE)
    if (isWebAppSigninPath(url.pathname)) return null

    const address = parseWebAppAddress(url.pathname)
    if (!address) return null

    return { appCode: address.code, address, target }
  } catch {
    return null
  }
}
