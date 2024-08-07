import type { Resolution } from '@/types/app'
import type { CommonNodeType, Memory, ModelConfig, PromptItem, ValueSelector, Variable } from '@/app/components/workflow/types'

export type LLMNodeType = CommonNodeType & {
  model: ModelConfig
  prompt_template: PromptItem[] | PromptItem
  prompt_config?: {
    jinja2_variables?: Variable[]
  }
  memory?: Memory
  context: {
    enabled: boolean
    variable_selector: ValueSelector
  }
  vision: {
    enabled: boolean
    configs?: {
      detail: Resolution
    }
  }
}
