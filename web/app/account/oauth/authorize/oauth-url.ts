export function buildReturnUrl(pathname: string, search: string) {
  try {
    return `${globalThis.location.origin}${pathname}${search}`
  } catch {
    return pathname + search
  }
}

export function buildOAuthCallbackUrl(redirectUri: string, code: string, state: string | null) {
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}
