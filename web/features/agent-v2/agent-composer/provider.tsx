'use client'

import type { ReactNode } from 'react'
import type { AgentSoulConfigFormState } from './form-state'
import { ScopeProvider } from 'jotai-scope'
import { defaultAgentSoulConfigFormState } from './form-state'
import { agentComposerDraftAtom, agentComposerSavedDraftAtom } from './store'

export function AgentComposerProvider({
  children,
  initialDraft,
}: {
  children: ReactNode
  initialDraft?: AgentSoulConfigFormState
}) {
  const draft = initialDraft ?? defaultAgentSoulConfigFormState

  return (
    <ScopeProvider
      atoms={[
        [agentComposerDraftAtom, draft],
        [agentComposerSavedDraftAtom, draft],
      ]}
      name="AgentComposer"
    >
      {children}
    </ScopeProvider>
  )
}
