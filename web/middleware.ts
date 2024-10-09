import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  // style-src 'self' 'nonce-${nonce}';
  const whiteList = '*.dify.dev *.dify.ai *.sentry.io http://localhost http://127.0.0.1 https://analytics.google.com https://googletagmanager.com https://api.github.com'
  const csp = (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_EDITION !== 'SELF_HOSTED') ? `'nonce-${nonce}'` : '\'unsafe-eval\' \'unsafe-inline\''

  const cspHeader = `
    default-src 'self' ${csp} blob: data: ${whiteList};
    connect-src 'self' ${csp} blob: data: ${whiteList};
    script-src 'self' ${csp} blob: ${whiteList};
    style-src 'self' 'unsafe-inline' ${whiteList};
    worker-src 'self' ${csp} blob: ${whiteList};
    media-src 'self' ${csp} blob: data: ${whiteList};
    img-src 'self' ${csp} blob: data: ${whiteList};
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
`
  // Replace newline characters and spaces
  const contentSecurityPolicyHeaderValue = cspHeader
    .replace(/\s{2,}/g, ' ')
    .trim()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  requestHeaders.set(
    'Content-Security-Policy',
    contentSecurityPolicyHeaderValue,
  )

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  response.headers.set(
    'Content-Security-Policy',
    contentSecurityPolicyHeaderValue,
  )

  return response
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
