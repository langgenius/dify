import type { CommonNodeType, Memory, ModelConfig, ValueSelector } from '@/app/components/workflow/types'

type Param = {

}
export type ParameterExtractorNodeType = CommonNodeType & {
  model: ModelConfig
  query: ValueSelector
  parameters: Param[]
  instruction: string
  memory?: Memory
}
