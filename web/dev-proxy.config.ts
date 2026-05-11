import type { CookieRewriteOptions, DevProxyConfig } from '@langgenius/dev-proxy'

const DIFY_CLOUD_TARGET = 'https://cloud.dify.ai'
const DEV_PROXY_TARGET = process.env.DEV_PROXY_TARGET || DIFY_CLOUD_TARGET
const DEV_PROXY_ENTERPRISE_TARGET = process.env.DEV_PROXY_ENTERPRISE_TARGET || DEV_PROXY_TARGET
const DEV_PROXY_HOST = process.env.DEV_PROXY_HOST || '127.0.0.1'
const DEV_PROXY_PORT = Number(process.env.DEV_PROXY_PORT || 5001)

const difyCookieRewrite: CookieRewriteOptions = {
  hostPrefixCookies: [
    'access_token',
    'csrf_token',
    'refresh_token',
    'webapp_access_token',
    /^passport-/,
  ],
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
      cookieRewrite: difyCookieRewrite,
    },
    {
      paths: [
        '/console/api',
        '/api',
      ],
      target: DEV_PROXY_TARGET,
      cookieRewrite: difyCookieRewrite,
    },
  ],
} satisfies DevProxyConfig
