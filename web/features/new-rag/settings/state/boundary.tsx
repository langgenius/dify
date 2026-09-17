'use client'

import type { ReactNode } from 'react'
import { ScopeProvider } from 'jotai-scope'
import { knowledgeSettingsEditSessionAtom } from './draft'
import { knowledgeSettingsSpaceIdAtom } from './inputs'
import { knowledgeSettingsScopedAtoms } from './workflow'

export function KnowledgeSettingsStateBoundary({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  return (
    <ScopeProvider
      key={knowledgeSpaceId}
      atoms={[
        ...knowledgeSettingsScopedAtoms,
        knowledgeSettingsEditSessionAtom,
        [knowledgeSettingsSpaceIdAtom, knowledgeSpaceId],
      ]}
      name="KnowledgeSettingsPage"
    >
      {children}
    </ScopeProvider>
  )
}
