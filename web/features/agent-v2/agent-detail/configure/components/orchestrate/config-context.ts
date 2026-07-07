'use client'

import { useAtomValue } from 'jotai'
import { createContext, use } from 'react'
import { agentComposerFilesAtom } from '@/features/agent-v2/agent-composer/store-modules/files'
import { agentComposerSkillsAtom } from '@/features/agent-v2/agent-composer/store-modules/skills'

export type AgentConfigApiContext = {
  agentId: string
  draftType?: 'draft' | 'debug_build'
  versionId?: string
  workflow?: {
    appId: string
    nodeId: string
  }
}

const AgentConfigApiContext = createContext<AgentConfigApiContext | null>(null)

export const AgentConfigApiContextProvider = AgentConfigApiContext.Provider

export const useAgentConfigApiContext = () => {
  const context = use(AgentConfigApiContext)
  if (!context)
    throw new Error('AgentConfigApiContextProvider is required for config-backed UI.')

  return context
}

export const useAgentConfigSkills = () => {
  const apiContext = useAgentConfigApiContext()
  const skills = useAtomValue(agentComposerSkillsAtom)

  return {
    apiContext,
    skills,
  }
}

export const useAgentConfigFiles = () => {
  const apiContext = useAgentConfigApiContext()
  const files = useAtomValue(agentComposerFilesAtom)

  return {
    apiContext,
    files,
  }
}
