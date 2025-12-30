'use client'

import { lazy, Suspense } from 'react'
import { IS_DEV } from '@/config'

const ReactScan = lazy(() =>
  import('./scan').then(module => ({
    default: module.ReactScan,
  })),
)

export const ReactScanLoader = () => {
  if (!IS_DEV)
    return null

  return (
    <Suspense fallback={null}>
      <ReactScan />
    </Suspense>
  )
}
