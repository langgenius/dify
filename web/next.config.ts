import type { NextConfig } from '@/next'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { env } from './env'

const openapiLoader = {
  loader: '@dify/openapi-content-mapper/loader',
}

const isDev = process.env.NODE_ENV === 'development'
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
  output: 'standalone',
  compiler: {
    removeConsole: isDev ? false : { exclude: ['warn', 'error'] },
  },
}

export default nextConfig
