import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type HumanInputNodeType = CommonNodeType & {
  deliveryMethod: any[]
  formContent: any
  userActions: any[]
  timeout: any
  outputs: Variable[]
}
