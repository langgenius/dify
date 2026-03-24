import type { NextConfig } from '@/next'
import createMDX from '@next/mdx'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { env } from './env'

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
  if (value === 'true')
    return true
  if (value === 'false')
    return false

  return undefined
}

const enableSourceMap = parseBooleanEnv(env.ENABLE_SOURCE_MAP)
const enableProdSourceMapsFallback = parseBooleanEnv(env.ENABLE_PROD_SOURCEMAP) ?? false
const enableProdSourceMaps = enableSourceMap ?? enableProdSourceMapsFallback
const isDev = process.env.NODE_ENV === 'development'
const withMDX = createMDX()

const nextConfig: NextConfig = {
  basePath: env.NEXT_PUBLIC_BASE_PATH,
  transpilePackages: ['@t3-oss/env-core', '@t3-oss/env-nextjs', 'echarts', 'zrender'],
  turbopack: {
    root: process.cwd(),
    rules: codeInspectorPlugin({
      bundler: 'turbopack',
    }),
  },
  webpack: (config, { dev: _dev, isServer: _isServer }) => {
    config.plugins.push(codeInspectorPlugin({ bundler: 'webpack' }))

    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    }
    config.output.environment = {
      asyncFunction: true,
    }

    return config
  },
  productionBrowserSourceMaps: enableProdSourceMaps, // enable browser source map generation during the production build
  // Configure pageExtensions to include md and mdx
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  typescript: {
    // https://nextjs.org/docs/api-reference/next.config.js/ignoring-typescript-errors
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/apps',
        permanent: false,
      },
    ]
  },
  output: 'standalone',
  compiler: {
    removeConsole: isDev ? false : { exclude: ['warn', 'error'] },
  },
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
}

export default withMDX(nextConfig)
