import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type ExitNodeType = CommonNodeType & {
  outputs: Variable[]
} 