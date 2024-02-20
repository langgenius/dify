import type { Resolution } from '@/types/app'
import type { CommonNodeType, Memory, ModelConfig, PromptItem, ValueSelector, Variable } from '@/app/components/workflow/types'

export type LLMNodeType = CommonNodeType & {
  model: ModelConfig
  variables: Variable[]
  prompt: PromptItem[] | PromptItem
  memory: Memory
  context: {
    enabled: boolean
    size: number
  }
  vision: {
    enabled: boolean
    variable_selector: ValueSelector
    configs: {
      detail: Resolution
    }
  }
}
