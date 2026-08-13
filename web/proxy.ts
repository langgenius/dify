// oxlint-disable-next-line no-restricted-imports
import type { NextRequest } from 'next/server'
import { Buffer } from 'node:buffer'
// oxlint-disable-next-line no-restricted-imports
import { NextResponse } from 'next/server'
import { env } from '@/env'

const NECESSARY_DOMAIN =
  '*.sentry.io http://localhost:* http://127.0.0.1:* https://analytics.google.com googletagmanager.com *.googletagmanager.com https://www.google-analytics.com https://cdn-cookieyes.com https://ungh.cc https://api2.amplitude.com *.amplitude.com'
const CURRENT_PATHNAME_HEADER = 'x-dify-pathname'
const CURRENT_SEARCH_HEADER = 'x-dify-search'
const EMBEDDABLE_PATH_SEGMENTS = [
  '/agent',
  '/chat',
  '/chatbot',
  '/completion',
  '/webapp-signin',
  '/workflow',
]
const NON_EMBEDDABLE_PATH_SEGMENTS = ['/device']
const FRAME_ANCESTORS_NONE = "frame-ancestors 'none';"
const LEGACY_EDUCATION_ACTION = 'getEducationVerify'

const matchesPathSegment = (pathname: string, segments: string[]) =>
  segments.some((segment) => pathname === segment || pathname.startsWith(`${segment}/`))

export const canEmbedPath = (pathname: string) =>
  matchesPathSegment(pathname, EMBEDDABLE_PATH_SEGMENTS)

const wrapResponseWithFrameProtection = (response: NextResponse, pathname: string) => {
  // Published app routes are intentionally embeddable; all other routes default to clickjacking protection.
  const preventEmbedding =
    matchesPathSegment(pathname, NON_EMBEDDABLE_PATH_SEGMENTS) ||
    (env.NEXT_PUBLIC_ALLOW_EMBED !== true && !canEmbedPath(pathname))

  if (preventEmbedding) {
    response.headers.set('X-Frame-Options', 'DENY')
    const contentSecurityPolicy = response.headers.get('Content-Security-Policy')
    response.headers.set(
      'Content-Security-Policy',
      contentSecurityPolicy
        ? `${contentSecurityPolicy} ${FRAME_ANCESTORS_NONE}`
        : FRAME_ANCESTORS_NONE,
    )
  }

  return response
}
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // TODO(2026-11-11): Remove after external education CTAs and active campaign links use the canonical route.
  if (pathname === '/' && request.nextUrl.searchParams.get('action') === LEGACY_EDUCATION_ACTION) {
    const destination = request.nextUrl.clone()
    destination.pathname = '/education/verify'
    destination.searchParams.delete('action')

    return wrapResponseWithFrameProtection(
      NextResponse.redirect(destination, { status: 308 }),
      pathname,
    )
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(CURRENT_PATHNAME_HEADER, pathname)
  requestHeaders.set(CURRENT_SEARCH_HEADER, search)

  const isWhiteListEnabled =
    !!env.NEXT_PUBLIC_CSP_WHITELIST && process.env.NODE_ENV === 'production'
  if (!isWhiteListEnabled) {
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
    return wrapResponseWithFrameProtection(response, pathname)
  }

  const turnstileOrigin = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    ? ' https://challenges.cloudflare.com'
    : ''
  const whiteList = `${env.NEXT_PUBLIC_CSP_WHITELIST} ${NECESSARY_DOMAIN}${turnstileOrigin}`
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = `'nonce-${nonce}'`

  const scheme_source = 'data: mediastream: blob: filesystem:'

  const cspHeader = `
    default-src 'self' ${scheme_source} ${csp} ${whiteList};
    connect-src 'self' ${scheme_source} ${csp} ${whiteList};
    script-src 'self' 'wasm-unsafe-eval' ${scheme_source} ${csp} ${whiteList};
    style-src 'self' 'unsafe-inline' ${scheme_source} ${whiteList};
    worker-src 'self' ${scheme_source} ${csp} ${whiteList};
    media-src 'self' ${scheme_source} ${csp} ${whiteList};
    img-src * data: blob:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    upgrade-insecure-requests;
`
  // Replace newline characters and spaces
  const contentSecurityPolicyHeaderValue = cspHeader.replace(/\s{2,}/g, ' ').trim()

  requestHeaders.set('x-nonce', nonce)

  requestHeaders.set('Content-Security-Policy', contentSecurityPolicyHeaderValue)

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  response.headers.set('Content-Security-Policy', contentSecurityPolicyHeaderValue)

  return wrapResponseWithFrameProtection(response, pathname)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - favicon.ico (favicon file)
     */
    {
      source: '/((?!_next/static|favicon.ico).*)',
      // source: '/(.*)',
      // missing: [
      //   { type: 'header', key: 'next-router-prefetch' },
      //   { type: 'header', key: 'purpose', value: 'prefetch' },
      // ],
    },
  ],
}
