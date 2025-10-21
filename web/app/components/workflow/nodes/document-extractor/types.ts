import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export type DocExtractorNodeType = CommonNodeType & {
  variable_selector: ValueSelector
  is_array_file: boolean
}
