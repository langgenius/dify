import type { CommonNodeType, Memory, ModelConfig, ValueSelector } from '@/app/components/workflow/types'

export enum ParamType {
  string = 'string',
  number = 'number',
  bool = 'bool',
  select = 'select',
}

export type Param = {
  name: string
  type: ParamType
  options?: string[]
  description: string
}

export type ParameterExtractorNodeType = CommonNodeType & {
  model: ModelConfig
  query: ValueSelector
  parameters: Param[]
  instruction: string
  memory?: Memory
}
