import { createSerwistRoute } from '@serwist/turbopack'

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'app/sw.ts',
  nextConfig: {
    basePath,
  },
  useNativeEsbuild: true,
})
