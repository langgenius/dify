import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export type VariableAssignerNodeType = CommonNodeType & {
  output_type: string
  variables: ValueSelector[]
}
