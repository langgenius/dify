'use client'

import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { createContext, use } from 'react'
import { useProviderContextSelector } from '@/context/provider-context'
import { agentComposerFilesAtom } from '@/features/agent-v2/agent-composer/store-modules/files'
import { agentComposerSkillsAtom } from '@/features/agent-v2/agent-composer/store-modules/skills'
import { consoleQuery } from '@/service/client'

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
  if (!context) throw new Error('AgentConfigApiContextProvider is required for config-backed UI.')

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

export const useAgentWorkspaceSkillBindings = () => {
  const { agentId } = useAgentConfigApiContext()
  const enableSkill = useProviderContextSelector((state) => state.enableSkill)

  return useQuery({
    ...consoleQuery.workspaces.current.agents.byAgentId.skills.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
    enabled: enableSkill,
  })
}

export const useAgentConfigFiles = () => {
  const apiContext = useAgentConfigApiContext()
  const files = useAtomValue(agentComposerFilesAtom)

  return {
    apiContext,
    files,
  }
}
