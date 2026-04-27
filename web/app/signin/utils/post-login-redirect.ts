// Persists target across full-page redirects within the same tab (social
// OAuth, SSO IdP bounce). sessionStorage is tab-scoped so concurrent
// /device tabs don't clobber each other. 15-min TTL drops stale values.
// Same-origin + exact-path whitelist prevents open-redirect.
//
// Signup-via-email-link opening in a new tab is out of scope — that tab
// starts with an empty sessionStorage and falls to /apps default.

const KEY = 'dify_post_login_redirect'
const TTL_MS = 15 * 60 * 1000

const ALLOWED: Record<string, ReadonlySet<string>> = {
  '/device': new Set(['user_code', 'sso_verified']),
  '/account/oauth/authorize': new Set(['client_id', 'scope', 'state', 'redirect_uri']),
}

function validate(target: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(target, window.location.origin)
    if (url.origin !== window.location.origin) return null
    const allowedKeys = ALLOWED[url.pathname]
    if (!allowedKeys) return null
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.has(key)) return null
    }
    return url.pathname + (url.search || '')
  }
  catch {
    return null
  }
}

export const setPostLoginRedirect = (value: string | null) => {
  if (typeof window === 'undefined') return
  if (value === null) {
    try { sessionStorage.removeItem(KEY) } catch {}
    return
  }
  const safe = validate(value)
  if (!safe) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ target: safe, ts: Date.now() }))
  }
  catch {}
}

export const resolvePostLoginRedirect = (): string | null => {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
  }
  catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed?.target !== 'string' || typeof parsed?.ts !== 'number') return null
    if (Date.now() - parsed.ts > TTL_MS) return null
    return validate(parsed.target)
  }
  catch {
    return null
  }
}
