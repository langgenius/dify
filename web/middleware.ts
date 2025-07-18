import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const NECESSARY_DOMAIN = '*.sentry.io http://localhost:* http://127.0.0.1:* https://analytics.google.com googletagmanager.com *.googletagmanager.com https://www.google-analytics.com https://api.github.com'

const wrapResponseWithXFrameOptions = (response: NextResponse, pathname: string) => {
  // prevent clickjacking: https://owasp.org/www-community/attacks/Clickjacking
  // Chatbot page should be allowed to be embedded in iframe. It's a feature
  if (process.env.NEXT_PUBLIC_ALLOW_EMBED !== 'true' && !pathname.startsWith('/chat') && !pathname.startsWith('/workflow') && !pathname.startsWith('/completion') && !pathname.startsWith('/webapp-signin'))
    response.headers.set('X-Frame-Options', 'DENY')

  return response
}
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const requestHeaders = new Headers(request.headers)
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  const isWhiteListEnabled = !!process.env.NEXT_PUBLIC_CSP_WHITELIST && process.env.NODE_ENV === 'production'
  if (!isWhiteListEnabled)
    return wrapResponseWithXFrameOptions(response, pathname)

  const whiteList = `${process.env.NEXT_PUBLIC_CSP_WHITELIST} ${NECESSARY_DOMAIN}`
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = `'nonce-${nonce}'`

  const scheme_source = 'data: mediastream: blob: filesystem:'

  const cspHeader = `
    default-src 'self' ${scheme_source} ${csp} ${whiteList};
    connect-src 'self' ${scheme_source} ${csp} ${whiteList};
    script-src 'self' ${scheme_source} ${csp} ${whiteList};
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
  const contentSecurityPolicyHeaderValue = cspHeader
    .replace(/\s{2,}/g, ' ')
    .trim()

  requestHeaders.set('x-nonce', nonce)

  requestHeaders.set(
    'Content-Security-Policy',
    contentSecurityPolicyHeaderValue,
  )

  response.headers.set(
    'Content-Security-Policy',
    contentSecurityPolicyHeaderValue,
  )

  return wrapResponseWithXFrameOptions(response, pathname)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    {
      // source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      // source: '/(.*)',
      // missing: [
      //   { type: 'header', key: 'next-router-prefetch' },
      //   { type: 'header', key: 'purpose', value: 'prefetch' },
      // ],
    },
  ],
}
