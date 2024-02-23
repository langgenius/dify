import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export enum EndVarType {
  none = 'none',
  plainText = 'plain-text',
  structured = 'structured',
}
export type OutPuts = {
  type: EndVarType
  plain_text_selector?: string[]
  structured_variables?: Variable[]
}
export type EndNodeType = CommonNodeType & {
  outputs: OutPuts
}
