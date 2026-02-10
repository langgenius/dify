import type { NextConfig } from 'next'
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
const isDev = env.NODE_ENV === 'development'
const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    // If you use remark-gfm, you'll need to use next.config.mjs
    // as the package is ESM only
    // https://github.com/remarkjs/remark-gfm#install
    remarkPlugins: [],
    rehypePlugins: [],
    // If you use `MDXProvider`, uncomment the following line.
    // providerImportSource: "@mdx-js/react",
  },
})

// the default url to prevent parse url error when running jest
const hasSetWebPrefix = env.NEXT_PUBLIC_WEB_PREFIX
const port = env.PORT
const locImageURLs = !hasSetWebPrefix ? [new URL(`http://localhost:${port}/**`), new URL(`http://127.0.0.1:${port}/**`)] : []
const remoteImageURLs = ([hasSetWebPrefix ? new URL(`${env.NEXT_PUBLIC_WEB_PREFIX}/**`) : '', ...locImageURLs].filter(item => !!item)) as URL[]

const nextConfig: NextConfig = {
  basePath: env.NEXT_PUBLIC_BASE_PATH,
  serverExternalPackages: ['esbuild'],
  transpilePackages: ['@t3-oss/env-core', '@t3-oss/env-nextjs', 'echarts', 'zrender'],
  turbopack: {
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
  // https://nextjs.org/docs/messages/next-image-unconfigured-host
  images: {
    remotePatterns: remoteImageURLs.map(remoteImageURL => ({
      protocol: remoteImageURL.protocol.replace(':', '') as 'http' | 'https',
      hostname: remoteImageURL.hostname,
      port: remoteImageURL.port,
      pathname: remoteImageURL.pathname,
      search: '',
    })),
  },
  typescript: {
    // https://nextjs.org/docs/api-reference/next.config.js/ignoring-typescript-errors
    ignoreBuildErrors: true,
  },
  reactStrictMode: true,
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
