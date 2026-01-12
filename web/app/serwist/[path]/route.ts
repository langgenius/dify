import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createSerwistRoute } from '@serwist/turbopack'

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout?.trim() || randomUUID()

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: [{ url: `${basePath}/_offline.html`, revision }],
  swSrc: 'app/sw.ts',
  nextConfig: {
    basePath,
  },
})
