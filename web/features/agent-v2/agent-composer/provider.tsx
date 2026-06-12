'use client'

import type { ReactNode } from 'react'
import type { AgentSoulConfigFormState } from './form-state'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { useState } from 'react'
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
  const [store] = useState(() => createAgentComposerStore(initialDraft))

  return (
    <JotaiProvider store={store}>
      {children}
    </JotaiProvider>
  )
}
