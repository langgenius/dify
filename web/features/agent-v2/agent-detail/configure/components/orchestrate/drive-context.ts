'use client'

import { useAtomValue } from 'jotai'
import { createContext, use, useMemo } from 'react'
import { agentComposerFilesAtom } from '@/features/agent-v2/agent-composer/store-modules/files'
import { agentComposerSkillsAtom } from '@/features/agent-v2/agent-composer/store-modules/skills'

export type AgentDriveApiContext = {
  agentId: string
  workflow?: {
    appId: string
    nodeId: string
  }
}

export const FILES_DRIVE_PREFIX = 'files/'

const AgentDriveApiContext = createContext<AgentDriveApiContext | null>(null)

export const AgentDriveApiContextProvider = AgentDriveApiContext.Provider

export const useAgentDriveApiContext = () => {
  const context = use(AgentDriveApiContext)
  if (!context)
    throw new Error('AgentDriveApiContextProvider is required for drive-backed UI.')

  return context
}

export const useAgentDriveSkills = () => {
  const apiContext = useAgentDriveApiContext()
  const skills = useAtomValue(agentComposerSkillsAtom)

  return {
    apiContext,
    skills,
  }
}

export const useAgentDriveFiles = ({
  prefix = FILES_DRIVE_PREFIX,
}: {
  prefix?: string
} = {}) => {
  const apiContext = useAgentDriveApiContext()
  const draftFiles = useAtomValue(agentComposerFilesAtom)
  const files = useMemo(
    () => draftFiles.filter(file => !prefix || file.driveKey?.startsWith(prefix)),
    [draftFiles, prefix],
  )

  return {
    apiContext,
    files,
  }
}
