const SHARE_ROUTE_DENY_LIST = new Set(['webapp-signin', 'check-code', 'login'])

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
