import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  // style-src 'self' 'nonce-${nonce}';
  const csp = process.env.NODE_ENV === 'production' ? `'nonce-${nonce}'` : '\'unsafe-eval\' \'unsafe-inline\''
  const whiteList = 'https://cloud.dify.dev/ https://cloud.dify.ai/ https://analytics.google.com https://googletagmanager.com https://api.github.com'

  const cspHeader = `
    default-src 'self' ${csp} ${whiteList};
    connect-src 'self' ${csp} ${whiteList};
    script-src 'self' ${csp} ${whiteList};
    style-src 'self' ${csp} ${whiteList};
    worker-src 'self' ${csp} ${whiteList};
    img-src 'self' blob: data: ${whiteList};
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
