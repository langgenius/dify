'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { knowledgeSettingsSpaceIdAtom } from './inputs'
import { knowledgeSettingsScopedAtoms } from './workflow'

export function KnowledgeSettingsStateBoundary({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  useHydrateAtoms([[knowledgeSettingsSpaceIdAtom, knowledgeSpaceId]], {
    dangerouslyForceHydrate: true,
  })

  return (
    <ScopeProvider
      key={knowledgeSpaceId}
      atoms={knowledgeSettingsScopedAtoms}
      name="KnowledgeSettingsPage"
    >
      {children}
    </ScopeProvider>
  )
}
