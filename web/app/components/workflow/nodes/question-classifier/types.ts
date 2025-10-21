import type { CommonNodeType, Memory, ModelConfig, ValueSelector, VisionSetting } from '@/app/components/workflow/types'

export type Topic = {
  id: string
  name: string
}

export type QuestionClassifierNodeType = CommonNodeType & {
  query_variable_selector: ValueSelector
  model: ModelConfig
  classes: Topic[]
  instruction: string
  memory?: Memory
  vision: {
    enabled: boolean
    configs?: VisionSetting
  }
}
