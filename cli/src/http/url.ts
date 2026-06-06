import type { SearchParamValue } from './types.js'

// Joins a base URL and a path, collapsing/inserting a single slash at the seam.
export function joinURL(base: string, path: string): string {
  if (base === '' || base === '/')
    return path === '' ? '/' : path
  if (path === '' || path === '/')
    return base

  const baseHasTrailing = base.endsWith('/')
  const pathHasLeading = path.startsWith('/')

  if (baseHasTrailing && pathHasLeading)
    return base + path.slice(1)
  if (!baseHasTrailing && !pathHasLeading)
    return `${base}/${path}`
  return base + path
}

// Only `undefined` is treated as "absent". Empty strings, 0, and false coerce
// through `String(...)` and land on the wire — e.g. `{ name: '' }` becomes
// `?name=`. API-client callers (see `apps.ts`, `account-sessions.ts`) collapse
// empty-string filters to `undefined` at their own layer; this helper does NOT
// do that for them, on purpose, so a caller that wants to send an explicit
// empty value still can.
export function appendSearchParams(url: string, params: Record<string, SearchParamValue> | undefined): string {
  if (params === undefined)
    return url

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined)
      continue
    search.append(key, String(value))
  }

  const qs = search.toString()
  if (qs === '')
    return url
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`
}
