import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export enum CodeLanguage {
  python3 = 'python3',
  javascript = 'javascript',
}

export type CodeNodeType = CommonNodeType & {
  variables: Variable[]
  code_language: CodeLanguage
  code: string
  outputs: {
    variable: string
    variable_type: string
  }[]
}
