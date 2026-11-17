const ACCOUNT_SIGN_IN_PATH = '/signin'

/**
 * The Console origin and deployment path prefix, derived from the Account sign-in URL in the
 * public bootstrap. The API appends the sign-in route to `CONSOLE_WEB_URL`, so removing that
 * route yields the Console base. Returns an empty string when the Console shares this
 * deployment's origin, and null when the value cannot describe a Console location.
 */
export function getConsoleBaseUrl(accountLoginUrl: string | null | undefined): string | null {
  if (!accountLoginUrl) return null

  const isAbsolute = /^https?:\/\//i.test(accountLoginUrl)
  const isRootedPath = accountLoginUrl.startsWith('/') && !accountLoginUrl.startsWith('//')
  if (!isAbsolute && !isRootedPath) return null

  let signInUrl: URL
  try {
    signInUrl = new URL(accountLoginUrl, 'http://console.invalid')
  } catch {
    return null
  }
  if (signInUrl.protocol !== 'http:' && signInUrl.protocol !== 'https:') return null
  if (!signInUrl.pathname.endsWith(ACCOUNT_SIGN_IN_PATH)) return null

  const path = signInUrl.pathname.slice(0, -ACCOUNT_SIGN_IN_PATH.length).replace(/\/+$/, '')
  return isAbsolute ? `${signInUrl.origin}${path}` : path
}
