import type { CommonNodeType, MediaConfig, ValueSelector } from '@/app/components/workflow/types'

export type MediaExtractorNodeType = CommonNodeType & {
  variable_selector: ValueSelector
  variable_config: MediaConfig
}
