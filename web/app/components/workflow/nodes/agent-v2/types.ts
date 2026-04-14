import type { CommonNodeType, Memory, ModelConfig, PromptItem, ValueSelector, VisionSetting } from '@/app/components/workflow/types'

export type ToolMetadata = {
  enabled: boolean
  type: string
  provider_name: string
  tool_name: string
  plugin_unique_identifier?: string
  credential_id?: string
  parameters: Record<string, any>
  settings: Record<string, any>
  extra: Record<string, any>
}

export type AgentV2NodeType = CommonNodeType & {
  model: ModelConfig
  prompt_template: PromptItem[] | PromptItem
  tools: ToolMetadata[]
  max_iterations: number
  agent_strategy: 'auto' | 'function-calling' | 'chain-of-thought'
  memory?: Memory
  context: {
    enabled: boolean
    variable_selector?: ValueSelector
  }
  vision: {
    enabled: boolean
    configs?: VisionSetting
  }
  structured_output_enabled?: boolean
  structured_output?: Record<string, any>
}
