import type { CommonNodeType, Memory, ModelConfig, ValueSelector } from '@/app/components/workflow/types'

type Topic = {
  id: string
  name: string
  topic: string
}

export type QuestionClassifierNodeType = CommonNodeType & {
  query_variable_selector: ValueSelector
  model: ModelConfig
  topics: Topic[]
  instruction: string
  memory: Memory
}
