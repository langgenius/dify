import type { ValueSelector } from '@/app/components/workflow/types'

// Generic variable types for all resource forms
export const VarKindType = {
  variable: 'variable',
  constant: 'constant',
  mixed: 'mixed',
} as const

export type VarKindType = (typeof VarKindType)[keyof typeof VarKindType]

// Generic resource variable inputs
export type ResourceVarInputs = Record<
  string,
  {
    type: VarKindType
    value?: string | ValueSelector | any
  }
>
