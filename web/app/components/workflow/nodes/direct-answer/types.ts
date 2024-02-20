import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type DirectAnswerNodeType = CommonNodeType & {
  variables: Variable[]
  answer: string
}
