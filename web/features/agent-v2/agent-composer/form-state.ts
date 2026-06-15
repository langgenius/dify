import type { AgentSoulAppFeaturesConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFileNode, AgentKnowledgeRetrievalItem } from '../agent-detail/configure/components/data'
import type { EnvVariable } from '../agent-detail/configure/components/orchestrate/advanced/env'
import type { AgentSkill } from '../agent-detail/configure/components/orchestrate/skills/item'
import type { AgentTool } from '../agent-detail/configure/components/orchestrate/tools/types'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'

export type AgentSoulConfigFormState = {
  prompt: string
  model?: DefaultModel
  appFeatures?: AgentSoulAppFeaturesConfig
  skills: AgentSkill[]
  files: AgentFileNode[]
  tools: AgentTool[]
  knowledgeRetrievals: AgentKnowledgeRetrievalItem[]
  envVariables: EnvVariable[]
  toolSettings: Record<string, Record<string, unknown>>
}

export const defaultAgentSoulConfigFormState: AgentSoulConfigFormState = {
  prompt: '',
  skills: [],
  files: [],
  tools: [],
  knowledgeRetrievals: [],
  envVariables: [],
  toolSettings: {},
}
