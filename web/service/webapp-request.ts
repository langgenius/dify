import type { WebAppAddress } from './webapp-address'
import { PUBLIC_API_PREFIX } from '@/config'
import { getWebAppPublicApiPath } from './webapp-address'

export function getWebAppApiBaseURL() {
  return new URL(PUBLIC_API_PREFIX, window.location.origin)
}

export function getWebAppApiRoute(requestURL: string) {
  const url = new URL(requestURL)
  const basePath = getWebAppApiBaseURL().pathname.replace(/\/$/, '')
  const path = url.pathname.startsWith(basePath)
    ? url.pathname.slice(basePath.length)
    : url.pathname
  return { url, basePath, path }
}

export function scopeWebAppRequestURL(
  { url, basePath, path }: ReturnType<typeof getWebAppApiRoute>,
  address: WebAppAddress | null,
  { preserveConfiguredPrefix = false } = {},
) {
  const scopedPath = getWebAppPublicApiPath(address, path)
  // The public client appends the path to the configured prefix as supplied.
  if (preserveConfiguredPrefix)
    return new URL(`${PUBLIC_API_PREFIX}${scopedPath}${url.search}`, window.location.origin)

  const scopedURL = new URL(url)
  scopedURL.pathname = `${basePath}${scopedPath}`
  return scopedURL
}

export async function withWebAppRequestURL(input: Request, url: URL, readBody: boolean) {
  if (url.href === input.url) return input

  // Buffer the body so a rewritten URL does not convert a JSON or file upload into a streaming request.
  const body = readBody ? await input.blob() : undefined
  return new Request(url, {
    method: input.method,
    headers: input.headers,
    body,
    signal: input.signal,
    credentials: input.credentials,
    mode: input.mode,
    cache: input.cache,
    redirect: input.redirect,
    referrer: input.referrer,
    referrerPolicy: input.referrerPolicy,
    integrity: input.integrity,
    keepalive: input.keepalive,
  })
}
