const SHARE_ROUTE_DENY_LIST = new Set(['webapp-signin', 'check-code', 'login'])

// The endpoints an app-deploy environment serves for its own webapp. Signing in
// is not among them: authentication stays with Dify, which issues the token the
// environment later exchanges for a passport. Listing what the gateway serves
// is safer than excluding auth paths, because `/login/status` is ours while
// `/login` is not.
const APP_DEPLOY_ROUTES = [
  '/passport',
  '/site',
  '/parameters',
  '/meta',
  '/login/status',
  '/webapp/access-mode',
  '/webapp/permission',
  '/workflows/run',
]

export const isAppDeployRoute = (url: string) => {
  // Callers pass paths with or without a leading slash; base() normalises that
  // later, so match on the normalised form or a bare name silently falls back
  // to Dify's public API.
  const withoutQuery = url.split('?')[0] || ''
  const path = (withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`).replace(/\/+$/, '')
  return APP_DEPLOY_ROUTES.some(route => path === route || path.startsWith(`${route}/`))
}

export const resolveShareCode = () => {
  const pathnameSegments = globalThis.location.pathname.split('/').filter(Boolean)
  const lastSegment = pathnameSegments.at(-1) || ''
  if (lastSegment && !SHARE_ROUTE_DENY_LIST.has(lastSegment)) return lastSegment

  const redirectParam = new URLSearchParams(globalThis.location.search).get('redirect_url')
  if (!redirectParam) return ''
  try {
    const redirectUrl = new URL(decodeURIComponent(redirectParam), globalThis.location.origin)
    const redirectSegments = redirectUrl.pathname.split('/').filter(Boolean)
    const redirectSegment = redirectSegments.at(-1) || ''
    return SHARE_ROUTE_DENY_LIST.has(redirectSegment) ? '' : redirectSegment
  } catch {
    return ''
  }
}
