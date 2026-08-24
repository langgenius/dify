const WEB_APP_ROUTE_SEGMENTS = new Set(['agent', 'chat', 'chatbot', 'completion', 'workflow'])
const WEB_APP_SIGNIN_SEGMENTS = new Set(['webapp-signin', 'check-code', 'login'])

export type WebAppAddress =
  | {
      kind: 'default'
      code: string
    }
  | {
      kind: 'environment'
      code: string
    }

const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`)

export const parseWebAppAddress = (pathname: string): WebAppAddress | null => {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'env') {
    const [, route, code, ...rest] = segments
    if (!route || !code || rest.length > 0 || !WEB_APP_ROUTE_SEGMENTS.has(route)) return null
    return { kind: 'environment', code }
  }

  const [route, code, ...rest] = segments
  if (!route || !code || rest.length > 0 || !WEB_APP_ROUTE_SEGMENTS.has(route)) return null
  if (WEB_APP_SIGNIN_SEGMENTS.has(code)) return null
  return { kind: 'default', code }
}

export const resolveWebAppAddress = (): WebAppAddress | null => {
  if (typeof globalThis.location === 'undefined') return null

  const currentAddress = parseWebAppAddress(globalThis.location.pathname)
  if (currentAddress) return currentAddress

  const redirectParam = new URLSearchParams(globalThis.location.search).get('redirect_url')
  if (!redirectParam) return null

  try {
    const redirectUrl = new URL(decodeURIComponent(redirectParam), globalThis.location.origin)
    return parseWebAppAddress(redirectUrl.pathname)
  } catch {
    return null
  }
}

export const getWebAppApiPath = (address: WebAppAddress | null, path: string) => {
  const normalizedPath = normalizePath(path)
  if (!address || address.kind === 'default') return normalizedPath
  return `/env/${address.code}${normalizedPath}`
}

export const getWebAppPassportKey = (address: WebAppAddress) => {
  if (address.kind === 'default') return address.code
  return `environment:${address.code}`
}

const isDifyWebAppAuthPath = (path: string) => {
  const pathname = normalizePath(path).split('?')[0] || ''
  return (
    pathname === '/login' ||
    pathname === '/logout' ||
    pathname === '/login/status' ||
    pathname.startsWith('/email-code-login') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/enterprise/sso/')
  )
}

export const getWebAppPublicApiPath = (address: WebAppAddress | null, path: string) => {
  if (!address || address.kind === 'default' || isDifyWebAppAuthPath(path))
    return normalizePath(path)
  return getWebAppApiPath(address, path)
}
