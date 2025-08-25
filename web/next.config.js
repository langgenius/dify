const { basePath, assetPrefix } = require('./utils/var-basePath')
const { codeInspectorPlugin } = require('code-inspector-plugin')
const withMDX = require('@next/mdx')({
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
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

// the default url to prevent parse url error when running jest
const hasSetWebPrefix = process.env.NEXT_PUBLIC_WEB_PREFIX
const port = process.env.PORT || 3000
const locImageURLs = !hasSetWebPrefix ? [new URL(`http://localhost:${port}/**`), new URL(`http://127.0.0.1:${port}/**`)] : []
const remoteImageURLs = [hasSetWebPrefix ? new URL(`${process.env.NEXT_PUBLIC_WEB_PREFIX}/**`) : '', ...locImageURLs].filter(item => !!item)

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  assetPrefix,
  turbopack: {
    rules: {
      "**/*.{jsx,tsx,js,mjs,mts}": Object.values(codeInspectorPlugin({
        bundler: 'turbopack',
      }))[0]
    }
  },
  productionBrowserSourceMaps: false, // enable browser source map generation during the production build
  // Configure pageExtensions to include md and mdx
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  // https://nextjs.org/docs/messages/next-image-unconfigured-host
  images: {
    remotePatterns: remoteImageURLs.map(remoteImageURL => ({
      protocol: remoteImageURL.protocol.replace(':', ''),
      hostname: remoteImageURL.hostname,
      port: remoteImageURL.port,
      pathname: remoteImageURL.pathname,
      search: '',
    })),
  },
  experimental: {
  },
  // fix all before production. Now it slow the develop speed.
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
    dirs: ['app', 'bin', 'config', 'context', 'hooks', 'i18n', 'models', 'service', 'test', 'types', 'utils'],
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
}

module.exports = withBundleAnalyzer(withMDX(nextConfig))
