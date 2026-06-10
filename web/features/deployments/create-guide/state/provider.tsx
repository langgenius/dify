'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { createDeploymentGuideLocalAtoms } from './atoms'

export function CreateDeploymentGuideProvider({ children }: {
  children: ReactNode
}) {
  return (
    <ScopeProvider
      atoms={createDeploymentGuideLocalAtoms}
      name="CreateDeploymentGuide"
    >
      {children}
    </ScopeProvider>
  )
}
