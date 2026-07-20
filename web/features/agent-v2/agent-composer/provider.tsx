'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import type { AgentSoulConfigFormState } from './form-state'
import { ScopeProvider } from 'jotai-scope'
import { defaultAgentSoulConfigFormState } from './form-state'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  agentComposerPublishedDraftAtom,
} from './store'

export function AgentComposerProvider({
  children,
  initialDraft,
  initialOriginalConfig,
}: {
  children: ReactNode
  initialDraft?: AgentSoulConfigFormState
  initialOriginalConfig?: AgentSoulConfig
}) {
  const draft = initialDraft ?? defaultAgentSoulConfigFormState

  return (
    <ScopeProvider
      atoms={[
        [agentComposerOriginalConfigAtom, initialOriginalConfig],
        [agentComposerDraftAtom, draft],
        [agentComposerOriginalDraftAtom, draft],
        [agentComposerPublishedDraftAtom, draft],
      ]}
      name="AgentComposer"
    >
      {children}
    </ScopeProvider>
  )
}
