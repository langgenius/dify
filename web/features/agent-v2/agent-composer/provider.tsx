'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import type { AgentSoulConfigFormState } from './form-state'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { useRef } from 'react'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  agentComposerPublishedDraftAtom,
} from './store'

function createAgentComposerStore({
  initialDraft,
  initialOriginalConfig,
}: {
  initialDraft?: AgentSoulConfigFormState
  initialOriginalConfig?: AgentSoulConfig
}) {
  const store = createStore()

  if (initialOriginalConfig)
    store.set(agentComposerOriginalConfigAtom, initialOriginalConfig)
  if (initialDraft)
    store.set(agentComposerDraftAtom, initialDraft)
  if (initialDraft)
    store.set(agentComposerOriginalDraftAtom, initialDraft)
  if (initialDraft)
    store.set(agentComposerPublishedDraftAtom, initialDraft)

  return store
}

export function AgentComposerProvider({
  children,
  initialDraft,
  initialOriginalConfig,
}: {
  children: ReactNode
  initialDraft?: AgentSoulConfigFormState
  initialOriginalConfig?: AgentSoulConfig
}) {
  const storeRef = useRef<ReturnType<typeof createAgentComposerStore> | null>(null)
  if (!storeRef.current) {
    storeRef.current = createAgentComposerStore({
      initialDraft,
      initialOriginalConfig,
    })
  }
  const store = storeRef.current

  return (
    <JotaiProvider store={store}>
      {children}
    </JotaiProvider>
  )
}
