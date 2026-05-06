import type { CookieRewriteOptions, DevProxyConfig } from '@langgenius/dev-proxy'

const DIFY_CLOUD_TARGET = 'https://cloud.dify.ai'
const DEV_PROXY_TARGET = process.env.DEV_PROXY_TARGET || DIFY_CLOUD_TARGET
const DEV_PROXY_HOST = process.env.DEV_PROXY_HOST || '127.0.0.1'
const DEV_PROXY_PORT = Number(process.env.DEV_PROXY_PORT || 5001)

const difyCookieRewrite: CookieRewriteOptions = {
  hostPrefixCookieNames: [
    'access_token',
    'csrf_token',
    'refresh_token',
    'webapp_access_token',
  ],
  hostPrefixCookieNamePatterns: [/^passport-/],
}

export default {
  server: {
    host: DEV_PROXY_HOST,
    port: DEV_PROXY_PORT,
  },
  routes: [
    {
      paths: '/console/api',
      target: DEV_PROXY_TARGET,
      cookieRewrite: difyCookieRewrite,
    },
    {
      paths: '/api',
      target: DEV_PROXY_TARGET,
      cookieRewrite: difyCookieRewrite,
    },
  ],
} satisfies DevProxyConfig
