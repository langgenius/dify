'use client'

import { lazy, Suspense } from 'react'
import { IS_DEV } from '@/config'

const ReactScan = lazy(() =>
  import('./react-scan').then(module => ({
    default: module.ReactScan,
  })),
)

const ReactScanLoader = () => {
  if (!IS_DEV)
    return null

  return (
    <Suspense fallback={null}>
      <ReactScan />
    </Suspense>
  )
}

export default ReactScanLoader
