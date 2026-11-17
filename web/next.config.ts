import type { NextConfig } from '@/next'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { env } from './env'

const openapiLoader = {
  loader: '@dify/openapi-content-mapper/loader',
}

const isDev = process.env.NODE_ENV === 'development'
// Cloudflare POC only: proxy the API through the Worker so the console and the API share one
// origin. On workers.dev the API's login cookies would otherwise be third-party and dropped.
// Every proxied call is a billed Worker request, so production should host the API on the same
// site instead.
const apiProxyOrigin =
  process.env.VINEXT_PLATFORM === 'cloudflare' ? process.env.CF_API_PROXY_ORIGIN : undefined
const allowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  basePath: env.NEXT_PUBLIC_BASE_PATH,
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  transpilePackages: ['@t3-oss/env-core', '@t3-oss/env-nextjs', 'echarts', 'zrender'],
  serverExternalPackages: ['loro-crdt'],
  turbopack: {
    rules: {
      ...codeInspectorPlugin({
        bundler: 'turbopack',
        behavior: { locate: true, defaultAction: 'locate' },
      }),
      '*.openapi': { loaders: [openapiLoader], as: '*.js' },
      '*.openapi-source': { loaders: [openapiLoader], as: '*.js' },
      '*openapi-namespace.js': { loaders: [openapiLoader], as: '*.js' },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /(?:\.openapi|\.openapi-source|openapi-namespace\.js)$/,
      type: 'javascript/auto',
      use: [openapiLoader],
    })
    return config
  },
  productionBrowserSourceMaps: false, // enable browser source map generation during the production build
  typescript: {
    // https://nextjs.org/docs/api-reference/next.config.js/ignoring-typescript-errors
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      {
        source: '/explore/apps',
        destination: '/',
        permanent: true,
      },
    ]
  },
  ...(apiProxyOrigin
    ? {
        async rewrites() {
          return {
            beforeFiles: [
              {
                source: '/console/api/:path*',
                destination: `${apiProxyOrigin}/console/api/:path*`,
              },
              { source: '/api/:path*', destination: `${apiProxyOrigin}/api/:path*` },
            ],
            afterFiles: [],
            fallback: [],
          }
        },
      }
    : {}),
  // The Cloudflare Workers build (vinext POC) emits its own Worker bundle instead of a Node server.
  output: process.env.VINEXT_PLATFORM === 'cloudflare' ? undefined : 'standalone',
  compiler: {
    removeConsole: isDev ? false : { exclude: ['warn', 'error'] },
  },
}

export default nextConfig
