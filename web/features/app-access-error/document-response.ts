// oxlint-disable-next-line no-restricted-imports -- Proxy is the pre-render HTTP boundary, which requires Next's response implementation.
import type { NextRequest } from 'next/server'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
// oxlint-disable-next-line no-restricted-imports -- A rewrite with an explicit status must run before Next starts streaming the document.
import { NextResponse } from 'next/server'
import { env } from '@/env'
import { isAccessMode } from '@/models/access-control'
import { parseWebAppAddress } from '@/service/webapp-address'

export const APP_UNAVAILABLE_PATH = '/webapp-unavailable'
export const APP_UNAVAILABLE_IP_HEADER = 'x-dify-app-unavailable-ip'
const PROXY_SECRET_HEADER = 'x-dify-webapp-proxy-secret'
const VERIFIED_IP_HEADER = 'x-dify-webapp-client-ip'
const MAX_PREFLIGHT_BYTES = 8192

function authenticatedProxyIp(request: NextRequest) {
  const expected = env.WEBAPP_ACCESS_PREFLIGHT_PROXY_SECRET
  const supplied = request.headers.get(PROXY_SECRET_HEADER)
  const ip = request.headers.get(VERIFIED_IP_HEADER)
  if (!expected || !supplied || !ip || !isIP(ip)) return undefined
  const expectedBytes = Buffer.from(expected)
  const suppliedBytes = Buffer.from(supplied)
  return expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
    ? ip
    : undefined
}

async function readPreflightPayload(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new Error('Unexpected preflight content type')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty preflight response')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_PREFLIGHT_BYTES) throw new Error('Preflight response too large')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel()
  }
}

/** A protocol failure is not evidence that an application does not exist. */
function unavailable() {
  return new NextResponse(null, { status: 503, headers: { 'Cache-Control': 'no-store' } })
}

function notFoundDocument(request: NextRequest, requestHeaders: Headers, ip?: string) {
  const destination = request.nextUrl.clone()
  destination.pathname = APP_UNAVAILABLE_PATH
  destination.search = ''
  // Keep only Next's transport-owned cache-busting value for RSC navigation.
  // Removing it causes Next's RSC validation to redirect before rendering.
  const rsc = request.nextUrl.searchParams.get('_rsc')
  if (rsc !== null) destination.searchParams.set('_rsc', rsc)
  requestHeaders.set('x-dify-pathname', APP_UNAVAILABLE_PATH)
  requestHeaders.set('x-dify-search', '')
  if (ip) requestHeaders.set(APP_UNAVAILABLE_IP_HEADER, ip)
  return NextResponse.rewrite(destination, {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
    request: { headers: requestHeaders },
  })
}

/**
 * Only the configured ingress can attest the visitor IP. The Gateway remains
 * the authorization owner; neither browser forwarding headers nor a direct
 * Core request can substitute for its decision.
 */
export async function getWebAppDocumentResponse(request: NextRequest, requestHeaders: Headers) {
  // These values must never survive from a browser request or reach page props.
  requestHeaders.delete(APP_UNAVAILABLE_IP_HEADER)
  requestHeaders.delete(PROXY_SECRET_HEADER)
  requestHeaders.delete(VERIFIED_IP_HEADER)

  const { pathname } = request.nextUrl
  if (pathname === APP_UNAVAILABLE_PATH) return notFoundDocument(request, requestHeaders)

  const address = parseWebAppAddress(pathname)
  if (!address || address.kind !== 'default' || !env.WEBAPP_ACCESS_PREFLIGHT_URL) return undefined

  const clientIp = authenticatedProxyIp(request)
  if (!clientIp) return unavailable()

  try {
    const url = new URL(env.WEBAPP_ACCESS_PREFLIGHT_URL)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      return unavailable()
    url.searchParams.set('appCode', decodeURIComponent(address.code))
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Forwarded-For': clientIp },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    })
    if (response.status !== 200 && response.status !== 404) return unavailable()
    const payload = await readPreflightPayload(response)
    if (typeof payload !== 'object' || payload === null) return unavailable()
    if (
      response.status === 200 &&
      'accessMode' in payload &&
      typeof payload.accessMode === 'string' &&
      isAccessMode(payload.accessMode)
    )
      return undefined
    if (
      response.status === 404 &&
      'code' in payload &&
      payload.code === 'app_not_found' &&
      'status' in payload &&
      payload.status === 404 &&
      'message' in payload &&
      payload.message === 'App not found.'
    )
      return notFoundDocument(request, requestHeaders, clientIp)
    return unavailable()
  } catch {
    // Do not log the URL, ingress proof, visitor IP, or upstream error body.
    return unavailable()
  }
}
