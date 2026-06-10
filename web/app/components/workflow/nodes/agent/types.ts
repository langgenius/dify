import type { AgentRosterNodeData } from '@/app/components/workflow/block-selector/types'
import type { CommonNodeType } from '@/app/components/workflow/types'

export type AgentNodeType = CommonNodeType & {
  agent_roster?: AgentRosterNodeData
}
