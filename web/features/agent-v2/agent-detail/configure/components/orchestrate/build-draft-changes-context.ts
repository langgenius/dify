'use client'

import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import type { ReactNode } from 'react'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { createContext, createElement, useContext, useMemo } from 'react'

export type AgentBuildDraftChangedKey = keyof AgentSoulConfigFormState

type AgentBuildDraftChangeOperation = 'added' | 'removed' | 'updated'

export type AgentBuildDraftChangeItem = {
  id: string
  name: string
  operation: AgentBuildDraftChangeOperation
  icon?: FileTreeIconType
  descriptionKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.buildDraft.'>
}

export type AgentBuildDraftChangeSummary = {
  changedKeys: readonly AgentBuildDraftChangedKey[]
  changesCount: number
  skills: readonly AgentBuildDraftChangeItem[]
  files: readonly AgentBuildDraftChangeItem[]
  envVariables: readonly AgentBuildDraftChangeItem[]
}

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
