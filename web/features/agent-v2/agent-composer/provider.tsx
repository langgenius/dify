'use client'

import type { ReactNode } from 'react'
import type { AgentComposerDraft } from './store'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { useState } from 'react'
import { agentComposerDraftAtom, agentComposerOriginalDraftAtom } from './store'

function createAgentComposerStore(initialDraft?: AgentComposerDraft) {
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
  initialDraft?: AgentComposerDraft
}) {
  const [store] = useState(() => createAgentComposerStore(initialDraft))

  return (
    <JotaiProvider store={store}>
      {children}
    </JotaiProvider>
  )
}
