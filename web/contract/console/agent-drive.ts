import { type } from '@orpc/contract'
import { base } from '../base'

export type AgentDriveSkillItem = {
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

export const agentDriveContracts = {
  byAgentId: {
    drive: {
      skills: {
        get: agentDriveSkillsByAgentContract,
      },
    },
  },
  byAppId: {
    agent: {
      drive: {
        skills: {
          get: agentDriveSkillsByAppContract,
        },
      },
    },
  },
}
