import type { NextConfig } from '@/next'
import { resolve } from 'node:path'
import createMDX from '@next/mdx'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { env } from './env'

const monorepoRoot = resolve(import.meta.dirname, '..')
const isDev = process.env.NODE_ENV === 'development'
const withMDX = createMDX()

const nextConfig: NextConfig = {
  basePath: env.NEXT_PUBLIC_BASE_PATH,
  transpilePackages: ['@t3-oss/env-core', '@t3-oss/env-nextjs', 'echarts', 'zrender'],
  turbopack: {
    root: monorepoRoot,
    rules: codeInspectorPlugin({
      bundler: 'turbopack',
    }),
  },
  outputFileTracingRoot: monorepoRoot,
  productionBrowserSourceMaps: false, // enable browser source map generation during the production build
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
