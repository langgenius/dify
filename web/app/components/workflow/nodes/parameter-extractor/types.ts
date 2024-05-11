import type { CommonNodeType } from '@/app/components/workflow/types'

export type ParameterExtractorNodeType = CommonNodeType & {
  query: string
}
