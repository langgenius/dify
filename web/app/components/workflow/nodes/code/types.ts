import type { CommonNodeType, VarType, Variable } from '@/app/components/workflow/types'

export enum CodeLanguage {
  python3 = 'python3',
  javascript = 'javascript',
  json = 'json',
}

export type OutputVar = Record<string, {
  type: VarType
  children: null // support nest in the future,
}>

export type CodeNodeType = CommonNodeType & {
  variables: Variable[]
  code_language: CodeLanguage
  code: string
  outputs: OutputVar
  dependencies?: CodeDependency[]
}

export type CodeDependency = {
  name: string
  version: string
}
