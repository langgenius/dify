'use client'

import type { AgentDriveItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFileNode, AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { useQuery } from '@tanstack/react-query'
import { createContext, use, useMemo } from 'react'
import { consoleQuery } from '@/service/client'
import { getDriveFileIconType } from './files/file-icon'

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

const getAgentDriveFileName = (key: string) => {
  const normalizedKey = key.endsWith('/') ? key.slice(0, -1) : key
  return normalizedKey.split('/').pop() || normalizedKey
}

const toAgentSkill = (item: {
  archive_key?: string | null
  description: string
  name: string
  path: string
  skill_md_key: string
}): AgentSkill => ({
  id: item.skill_md_key,
  name: item.name,
  description: item.description || undefined,
  path: item.path,
  skillMdKey: item.skill_md_key,
  archiveKey: item.archive_key ?? undefined,
})

const toAgentFileNodeFromDriveItem = (item: {
  file_kind: string
  key: string
  mime_type?: string | null
}): AgentFileNode => ({
  id: item.key,
  name: getAgentDriveFileName(item.key),
  icon: getDriveFileIconType({
    fileKind: item.file_kind,
    fileName: getAgentDriveFileName(item.key),
    mimeType: item.mime_type,
  }),
  driveKey: item.key,
})

export const useAgentDriveApiContext = () => {
  const context = use(AgentDriveApiContext)
  if (!context)
    throw new Error('AgentDriveApiContextProvider is required for drive-backed UI.')

  return context
}

export const useAgentDriveSkills = () => {
  const apiContext = useAgentDriveApiContext()
  const agentSkillsQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.skills.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
        },
      },
    }),
    enabled: !apiContext.workflow,
  })
  const workflowSkillsQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.drive.skills.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
        },
      },
    }),
    enabled: !!apiContext.workflow,
  })
  const query = apiContext.workflow ? workflowSkillsQuery : agentSkillsQuery
  const skills = useMemo(() => (query.data?.items ?? []).map(toAgentSkill), [query.data?.items])

  return {
    apiContext,
    query,
    skills,
  }
}

export const useAgentDriveFiles = ({
  prefix = FILES_DRIVE_PREFIX,
}: {
  prefix?: string
} = {}) => {
  const apiContext = useAgentDriveApiContext()
  const agentFilesQuery = useQuery({
    ...consoleQuery.agent.byAgentId.drive.files.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
        },
        query: {
          prefix,
        },
      },
    }),
    enabled: !apiContext.workflow,
  })
  const workflowFilesQuery = useQuery({
    ...consoleQuery.apps.byAppId.agent.drive.files.get.queryOptions({
      input: {
        params: {
          app_id: apiContext.workflow?.appId ?? '',
        },
        query: {
          node_id: apiContext.workflow?.nodeId,
          prefix,
        },
      },
    }),
    enabled: !!apiContext.workflow,
  })
  const query = apiContext.workflow ? workflowFilesQuery : agentFilesQuery
  const files = useMemo(
    () => (query.data?.items ?? []).map((item: AgentDriveItemResponse) => toAgentFileNodeFromDriveItem(item)),
    [query.data?.items],
  )

  return {
    apiContext,
    query,
    files,
  }
}
