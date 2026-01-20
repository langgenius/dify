import type { ValueSelector } from '@/app/components/workflow/types'

// Generic variable types for all resource forms
export enum VarKindType {
  variable = 'variable',
  constant = 'constant',
  mixed = 'mixed',
  mention = 'mention',
}

export type MentionConfig = {
  extractor_node_id: string
  output_selector: ValueSelector
  null_strategy: 'raise_error' | 'use_default'
  default_value: unknown
}

// Generic resource variable inputs
export type ResourceVarInputs = Record<string, {
  type: VarKindType
  value?: string | ValueSelector | any
  mention_config?: MentionConfig
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
