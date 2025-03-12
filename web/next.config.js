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

const isDev = process.env.NODE_ENV !== 'production'

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.infrastructureLogging = {
        level: 'none',
        debug: false,
      }
      config.watchOptions = {
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.next/**',
          '**/public/**',
          '**/.storybook/**',
          '**/assets/**',
          '**/bin/**',
          '**/models/**',
          '**/themes/**',
          '**/utils/**',
          // '**/*',
          // '!**/app/**',
          // '**/app/forgot-password**',
          // '**/app/reset-password**',
          // '**/app/account**',
          // '**/app/repos**',

        ],
        aggregateTimeout: 300, // 延迟重新构建的时间，单位为毫秒
        poll: 1000, // 检测文件变化的时间间隔，单位为毫秒
      }
      config.optimization = {
        ...config.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
        // minimizer: false,
        // concatenateModules: false,
        // usedExports: false,
      }
      // 3. 缓存优化
      // config.cache = {
      //   type: 'filesystem',
      //   version: `${process.env.NODE_ENV}-${process.version}`,
      //   buildDependencies: {
      //     config: [__filename],
      //   },
      //   // cacheDirectory: '.next/cache',
      // }
      // 4. 模块解析优化
      // config.resolve = {
      //   ...config.resolve,
      //   symlinks: false,
      //   preferRelative: true,
      //   fallback: {
      //     ...config.resolve.fallback,
      //     fs: false,
      //     path: false,
      //   },
      // }

      // // 5. 开发环境性能提示关闭
      // config.performance = {
      //   hints: false,
      // }

      // // 6. 监听配置优化
      // config.watchOptions = {
      //   aggregateTimeout: 200,
      //   ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**'],
      // }

      // 7. 源码映射优化
      config.devtool = 'eval-source-map'
      // config.devtool = false
    }
    else {
      config.plugins.push(codeInspectorPlugin({ bundler: 'webpack' }))
    }
    return config
  },
  productionBrowserSourceMaps: false, // enable browser source map generation during the production build
  // Configure pageExtensions to include md and mdx
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  experimental: {
  },
  // fix all before production. Now it slow the develop speed.
  eslint: {
    enabled: false,
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
    // dirs: ['app', 'bin', 'config', 'context', 'hooks', 'i18n', 'models', 'service', 'test', 'types', 'utils'],
  },
  typescript: {
    enabled: false,
    // https://nextjs.org/docs/api-reference/next.config.js/ignoring-typescript-errors
    ignoreBuildErrors: true,
  },
  // reactStrictMode: true,
  // 关闭一些开发时不必要的功能
  reactStrictMode: isDev,
  // 优化开发服务器性能
  onDemandEntries: {
    // 页面缓存时间
    maxInactiveAge: 25 * 1000,
    // 同时缓存的页面数
    pagesBufferLength: 2,
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
  // 9. 开发服务器配置
  devIndicators: {
    buildActivity: false,
  },
  // 12. 压缩配置
  compress: !isDev, // 开发时禁用压缩
  output: 'standalone',
}

module.exports = withMDX(nextConfig)
