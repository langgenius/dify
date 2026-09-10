'use client'

import type { LoginRedirectTarget } from './login-redirect'
import { resolveLoginRedirectTarget } from './login-redirect'

type RouterReplace = (href: string) => void

function normalizeBasePath(value: string) {
  if (!value || value === '/') return ''
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.replace(/\/+$/, '')
}

function removeBasePathOnce(href: string, basePath: string) {
  const normalizedBasePath = normalizeBasePath(basePath)
  if (!normalizedBasePath) return href

  const url = new URL(href, 'https://login-redirect.invalid')
  let pathname = url.pathname
  if (pathname === normalizedBasePath) pathname = '/'
  else if (pathname.startsWith(`${normalizedBasePath}/`))
    pathname = pathname.slice(normalizedBasePath.length) || '/'

  return `${pathname}${url.search}${url.hash}`
}

export function replaceLoginRedirect(
  target: LoginRedirectTarget,
  routerReplace: RouterReplace,
  basePath: string,
) {
  if (target.kind === 'absolute') {
    globalThis.location.replace(target.href)
    return
  }

  const hrefWithoutBasePath = removeBasePathOnce(target.href, basePath)
  const safeTarget = resolveLoginRedirectTarget(hrefWithoutBasePath)
  routerReplace(safeTarget?.kind === 'internal' ? safeTarget.href : '/')
}
