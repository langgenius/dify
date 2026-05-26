import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type EndNodeType = CommonNodeType & {
  outputs: Variable[]
}
