import { type } from '@orpc/contract'
import { base } from '../base'

type AgentDriveSkillItem = {
  path: string
  skill_md_key: string
  archive_key?: string | null
  name: string
  description: string
  size?: number | null
  mime_type?: string | null
  hash?: string | null
  created_at?: number | null
}

type AgentDriveSkillFile = {
  available_in_drive: boolean
  drive_key?: string | null
  name: string
  path: string
  type: string
}

type AgentDriveSkillMarkdown = {
  binary: boolean
  key: string
  size?: number | null
  text?: string | null
  truncated: boolean
}

type AgentDriveSkillInspect = AgentDriveSkillItem & {
  file_tree?: Array<Record<string, unknown>>
  files?: AgentDriveSkillFile[]
  skill_md: AgentDriveSkillMarkdown
  source: string
  warnings?: string[]
}

const agentDriveSkillsByAgentContract = base
  .route({
    path: '/agent/{agent_id}/drive/skills',
    method: 'GET',
  })
  .input(type<{
    params: {
      agent_id: string
    }
  }>())
  .output(type<{ items: AgentDriveSkillItem[] }>())

const agentDriveSkillInspectByAgentContract = base
  .route({
    path: '/agent/{agent_id}/drive/skills/{skill_path}/inspect',
    method: 'GET',
  })
  .input(type<{
    params: {
      agent_id: string
      skill_path: string
    }
  }>())
  .output(type<AgentDriveSkillInspect>())

const agentDriveSkillsByAppContract = base
  .route({
    path: '/apps/{app_id}/agent/drive/skills',
    method: 'GET',
  })
  .input(type<{
    params: {
      app_id: string
    }
    query?: {
      node_id?: string
    }
  }>())
  .output(type<{ items: AgentDriveSkillItem[] }>())

const agentDriveSkillInspectByAppContract = base
  .route({
    path: '/apps/{app_id}/agent/drive/skills/{skill_path}/inspect',
    method: 'GET',
  })
  .input(type<{
    params: {
      app_id: string
      skill_path: string
    }
    query?: {
      node_id?: string
    }
  }>())
  .output(type<AgentDriveSkillInspect>())

export const agentDriveContracts = {
  byAgentId: {
    drive: {
      skills: {
        get: agentDriveSkillsByAgentContract,
        bySkillPath: {
          inspect: {
            get: agentDriveSkillInspectByAgentContract,
          },
        },
      },
    },
  },
  byAppId: {
    agent: {
      drive: {
        skills: {
          get: agentDriveSkillsByAppContract,
          bySkillPath: {
            inspect: {
              get: agentDriveSkillInspectByAppContract,
            },
          },
        },
      },
    },
  },
}
