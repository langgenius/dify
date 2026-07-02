'use client'

import type { ReactNode } from 'react'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { createContext, createElement, useContext, useMemo } from 'react'

export type AgentBuildDraftChangedKey = keyof AgentSoulConfigFormState

export type AgentBuildDraftChangeSection
  = | 'skills'
    | 'files'
    | 'advancedSettings'

const changedKeysBySection: Record<AgentBuildDraftChangeSection, readonly AgentBuildDraftChangedKey[]> = {
  skills: ['skills'],
  files: ['files'],
  advancedSettings: ['envVariables'],
}

const AgentBuildDraftChangedKeysContext = createContext<ReadonlySet<AgentBuildDraftChangedKey>>(new Set())

export function AgentBuildDraftChangedKeysProvider({
  changedKeys,
  children,
}: {
  changedKeys: readonly AgentBuildDraftChangedKey[]
  children: ReactNode
}) {
  const changedKeySet = useMemo(() => new Set(changedKeys), [changedKeys])

  return createElement(
    AgentBuildDraftChangedKeysContext.Provider,
    { value: changedKeySet },
    children,
  )
}

export function useIsAgentBuildDraftSectionChanged(section?: AgentBuildDraftChangeSection) {
  const changedKeys = useContext(AgentBuildDraftChangedKeysContext)

  if (!section)
    return false

  return changedKeysBySection[section].some(key => changedKeys.has(key))
}
