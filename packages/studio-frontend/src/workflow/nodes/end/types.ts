import type { CommonNodeType, Variable } from '../../types'

export type EndNodeType = CommonNodeType & {
  outputs: Variable[]
}
