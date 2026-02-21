import { createSerwistRoute } from '@serwist/turbopack'
import { env } from '@/env'

const basePath = env.NEXT_PUBLIC_BASE_PATH

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'app/sw.ts',
  nextConfig: {
    basePath,
  },
  useNativeEsbuild: true,
})
