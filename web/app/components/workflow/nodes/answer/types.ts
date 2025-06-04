import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type AnswerNodeType = CommonNodeType & {
  outputs: Variable[]
  variables: Variable[]
  answer: string
}
