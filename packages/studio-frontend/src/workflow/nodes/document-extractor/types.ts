import type { CommonNodeType, ValueSelector } from '../../types'

export type DocExtractorNodeType = CommonNodeType & {
  variable_selector: ValueSelector
  is_array_file: boolean
}
