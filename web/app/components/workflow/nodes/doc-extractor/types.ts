import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export type DocExtractorNodeType = CommonNodeType & {
  variable: ValueSelector
}
