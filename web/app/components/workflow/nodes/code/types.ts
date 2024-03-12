import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export enum CodeLanguage {
  python3 = 'python3',
  javascript = 'javascript',
  json = 'json',
}

export enum OutputVarType {
  string = 'string',
  number = 'number',
  boolean = 'boolean',
  object = 'object',
}

export type OutputVar = Record<string, {
  type: OutputVarType
  children: null // support nest in the future,
}>

export type CodeNodeType = CommonNodeType & {
  variables: Variable[]
  code_language: CodeLanguage
  code: string
  outputs: OutputVar
}
