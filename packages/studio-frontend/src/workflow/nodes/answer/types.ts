import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type AnswerNodeType = CommonNodeType & {
  variables: Variable[]
  answer: string
}
