import type { CookieRewriteOptions, DevProxyConfig } from '@langgenius/dev-proxy'

const DEV_PROXY_TARGET = process.env.DEV_PROXY_TARGET?.trim()
if (!DEV_PROXY_TARGET)
  throw new Error('Set DEV_PROXY_TARGET in web/.env.local to start the development proxy.')

const DEV_PROXY_ENTERPRISE_TARGET = process.env.DEV_PROXY_ENTERPRISE_TARGET || DEV_PROXY_TARGET
const DEV_PROXY_PUBLIC_TARGET = process.env.DEV_PROXY_PUBLIC_TARGET || DEV_PROXY_TARGET
const DEV_PROXY_HOST = process.env.DEV_PROXY_HOST || '127.0.0.1'
const DEV_PROXY_PORT = Number(process.env.DEV_PROXY_PORT || 5001)
const DEV_PROXY_CF_ACCESS_CLIENT_ID = process.env.DEV_PROXY_CF_ACCESS_CLIENT_ID
const DEV_PROXY_CF_ACCESS_CLIENT_SECRET = process.env.DEV_PROXY_CF_ACCESS_CLIENT_SECRET

if (Boolean(DEV_PROXY_CF_ACCESS_CLIENT_ID) !== Boolean(DEV_PROXY_CF_ACCESS_CLIENT_SECRET))
  throw new Error(
    'Configure both DEV_PROXY_CF_ACCESS_CLIENT_ID and DEV_PROXY_CF_ACCESS_CLIENT_SECRET.',
  )

const cloudflareAccessHeaders =
  DEV_PROXY_CF_ACCESS_CLIENT_ID && DEV_PROXY_CF_ACCESS_CLIENT_SECRET
    ? {
        'CF-Access-Client-Id': DEV_PROXY_CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': DEV_PROXY_CF_ACCESS_CLIENT_SECRET,
      }
    : undefined

const difyCookieRewrite: CookieRewriteOptions = {
  hostPrefixCookies: [
    'access_token',
    'csrf_token',
    'refresh_token',
    'webapp_access_token',
    /^passport-/,
  ],
  localCookieScope: 'target-origin',
  csrfHeader: {
    cookieName: 'csrf_token',
    headerName: 'X-CSRF-Token',
  },
}

export default {
  server: {
    host: DEV_PROXY_HOST,
    port: DEV_PROXY_PORT,
  },
  routes: [
    {
      paths: [
        '/console/api/enterprise',
        '/api/enterprise',
        '/admin-api',
        '/inner/api',
        '/mfa',
        '/scim',
        '/v1/audit',
        '/v1/dashboard',
        '/v1/healthz',
        '/v1/plugin-manager',
      ],
      target: DEV_PROXY_ENTERPRISE_TARGET,
      requestHeaders: cloudflareAccessHeaders,
      cookieRewrite: difyCookieRewrite,
    },
    {
      paths: ['/console/api', '/socket.io'],
      target: DEV_PROXY_TARGET,
      requestHeaders: cloudflareAccessHeaders,
      cookieRewrite: difyCookieRewrite,
    },
    {
      paths: ['/api'],
      target: DEV_PROXY_PUBLIC_TARGET,
      requestHeaders: cloudflareAccessHeaders,
      cookieRewrite: difyCookieRewrite,
    },
  ],
  sessionImport: {
    refreshPath: '/console/api/refresh-token',
    cookieName: 'refresh_token',
    redirectTo: 'http://localhost:3000',
  },
} satisfies DevProxyConfig
