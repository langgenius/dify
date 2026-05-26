import type { CommonNodeType, Variable } from '../../types'

export type AnswerNodeType = CommonNodeType & {
  variables: Variable[]
  answer: string
}
