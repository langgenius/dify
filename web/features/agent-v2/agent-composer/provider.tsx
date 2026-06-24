'use client'

import type { ReactNode } from 'react'
import type { AgentSoulConfigFormState } from './form-state'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { useRef } from 'react'
import { agentComposerDraftAtom, agentComposerOriginalDraftAtom } from './store'

function createAgentComposerStore(initialDraft?: AgentSoulConfigFormState) {
  const store = createStore()

  if (initialDraft)
    store.set(agentComposerDraftAtom, initialDraft)
  if (initialDraft)
    store.set(agentComposerOriginalDraftAtom, initialDraft)

  return store
}

export function AgentComposerProvider({
  children,
  initialDraft,
}: {
  children: ReactNode
  initialDraft?: AgentSoulConfigFormState
}) {
  const storeRef = useRef<ReturnType<typeof createAgentComposerStore> | null>(null)
  if (!storeRef.current)
    storeRef.current = createAgentComposerStore(initialDraft)
  const store = storeRef.current

  return (
    <JotaiProvider store={store}>
      {children}
    </JotaiProvider>
  )
}
