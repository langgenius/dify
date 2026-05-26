import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type TemplateTransformNodeType = CommonNodeType & {
  variables: Variable[]
  template: string
}
