import type { ValueSelector } from '@/app/components/workflow/types'

// Generic variable types for all resource forms
export enum VarKindType {
  variable = 'variable',
  constant = 'constant',
  mixed = 'mixed',
}

// Generic resource variable inputs
export type ResourceVarInputs = Record<string, {
  type: VarKindType
  value?: string | ValueSelector | any
}>

// Base resource interface
export type BaseResource = {
  name: string
  [key: string]: any
}

// Base resource provider interface
export type BaseResourceProvider = {
  plugin_id?: string
  name: string
  [key: string]: any
}
