import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type EventSourceNodeType = CommonNodeType & {
  variables: Variable[]
  template: string
}
