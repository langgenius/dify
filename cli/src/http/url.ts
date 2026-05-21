import type { SearchParamValue } from './types.js'

// Ported from ofetch/src/utils.url.ts (joinURL).
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
