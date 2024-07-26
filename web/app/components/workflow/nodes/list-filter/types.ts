import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export type ListFilterNodeType = CommonNodeType & {
  variable: ValueSelector
}
