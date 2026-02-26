'use client'

import { lazy, Suspense } from 'react'
import { IS_DEV } from '@/config'

const TanStackDevtoolsWrapper = lazy(() =>
  import('./devtools').then(module => ({
    default: module.TanStackDevtoolsWrapper,
  })),
)

export const TanStackDevtoolsLoader = () => {
  if (!IS_DEV)
    return null

  return (
    <Suspense fallback={null}>
      <TanStackDevtoolsWrapper />
    </Suspense>
  )
}
