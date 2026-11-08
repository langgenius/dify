import type { CommonNodeType, Variable, VarType } from '@/app/components/workflow/types'

export const CodeLanguage = {
  python3: 'python3',
  javascript: 'javascript',
  json: 'json',
} as const

export type CodeLanguage = (typeof CodeLanguage)[keyof typeof CodeLanguage]

export type OutputVar = Record<
  string,
  {
    type: VarType
    children: null // support nest in the future,
  }
>

export type CodeNodeType = CommonNodeType & {
  variables: Variable[]
  code_language: CodeLanguage
  code: string
  outputs: OutputVar
}
