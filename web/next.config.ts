import type { NextConfig } from '@/next'
import createMDX from '@next/mdx'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { env } from './env'

const isDev = process.env.NODE_ENV === 'development'
const withMDX = createMDX()
const allowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  basePath: env.NEXT_PUBLIC_BASE_PATH,
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  transpilePackages: ['@t3-oss/env-core', '@t3-oss/env-nextjs', 'echarts', 'zrender'],
  serverExternalPackages: ['loro-crdt'],
  turbopack: {
    // `loro-crdt`'s default `browser` and `base64` builds both
    // synchronously call `new WebAssembly.Module(buffer)` on the
    // module's main thread, which Chromium throws on with
    //   "RangeError: WebAssembly.compile is disallowed on the main
    //    thread, if the buffer size is larger than 4KB"
    // (the WASM blob in this package is well over 4KB). Newer
    // Chromium/Firefox versions happen to keep the SPA working here,
    // but older browsers — the exact ones users report hitting in
    // issue #38532 — do not, so the registration page and other
    // top-level layouts that transitively import the workflow
    // collaboration manager blow up before hydration completes.
    //
    // The `bundler` subpath re-exports the same surface but
    // initializes the WASM asynchronously through
    // `WebAssembly.instantiate` / `WebAssembly.instantiateStreaming`
    // (which is allowed on the main thread because it returns a
    // Promise, not a synchronous `Module`/`compile`). Aliasing
    // `loro-crdt` to `loro-crdt/bundler` for `condition: browser` only
    // makes the production client bundle safe on every supported
    // browser without affecting the Node.js server bundle (where
    // `serverExternalPackages` above still keeps `loro-crdt`
    // external). See the matching Vite alias in `web/vite.config.ts`
    // (which only covers Vite-based pipelines like vitest/vinext).
    resolveAlias: {
      'loro-crdt': { browser: 'loro-crdt/bundler' },
    },
    rules: codeInspectorPlugin({
      bundler: 'turbopack',
    }),
  },
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
        source: '/explore/apps',
        destination: '/',
        permanent: false,
      },
    ]
  },
  // Deny framing on device-flow routes — no trusted embedder exists.
  async headers() {
    const antiFrame = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    ]
    return [
      { source: '/device', headers: antiFrame },
      { source: '/device/:path*', headers: antiFrame },
    ]
  },
  output: 'standalone',
  compiler: {
    removeConsole: isDev ? false : { exclude: ['warn', 'error'] },
  },
}

export default withMDX(nextConfig)
