'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { createDeploymentGuideScopedAtoms } from './index'

export function CreateDeploymentGuideProvider({ children }: {
  children: ReactNode
}) {
  return (
    <ScopeProvider atoms={createDeploymentGuideScopedAtoms}>
      {children}
    </ScopeProvider>
  )
}
