'use client'

import { lazy, Suspense } from 'react'
import { IS_DEV } from '@/config'

const Agentation = lazy(() =>
  import('./agentation').then(module => ({
    default: module.Agentation,
  })),
)

export const AgentationLoader = () => {
  if (!IS_DEV)
    return null

  return (
    <Suspense fallback={null}>
      <Agentation />
    </Suspense>
  )
}
