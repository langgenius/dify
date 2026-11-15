import type { Topic } from '../_base/components/branch-list/types'
import type {
  CommonNodeType,
  Memory,
  ModelConfig,
  ValueSelector,
  VisionSetting,
} from '@/app/components/workflow/types'

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
