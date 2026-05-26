import type { CommonNodeType, Variable } from '../../types'

export type TemplateTransformNodeType = CommonNodeType & {
  variables: Variable[]
  template: string
}
