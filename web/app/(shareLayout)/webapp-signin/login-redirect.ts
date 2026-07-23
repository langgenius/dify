import type { LoginRedirectTarget } from '@/utils/login-redirect'
import { resolveLoginRedirectTarget } from '@/utils/login-redirect'

const INTERNAL_PATH_PARSE_BASE = 'https://login-redirect.invalid'

export type WebAppLoginRedirect = {
  appCode: string
  target: LoginRedirectTarget
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

    const appCode = url.pathname.split('/').filter(Boolean).at(-1)
    if (!appCode) return null

    return { appCode, target }
  } catch {
    return null
  }
}
