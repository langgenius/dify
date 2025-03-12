import type { CommonNodeType, Memory, ModelConfig, PromptItem, ValueSelector, Variable, VisionSetting } from '@/app/components/workflow/types'

export type LLMNodeType = CommonNodeType & {
  model: ModelConfig
  prompt_template: PromptItem[] | PromptItem
  prompt_config?: {
    jinja2_variables?: Variable[]
  }
  memory?: Memory
  context: {
    enabled: boolean
    variable_selector: ValueSelector
  }
  vision: {
    enabled: boolean
    configs?: VisionSetting
  }
}

export enum Type {
  string = 'string',
  number = 'number',
  boolean = 'boolean',
  object = 'object',
  array = 'array',
}

export enum ArrayType {
  string = 'array[string]',
  number = 'array[number]',
  boolean = 'array[boolean]',
  object = 'array[object]',
}

export type TypeWithArray = Type | ArrayType

type ArrayItemType = Exclude<Type, Type.array>

export type Field = {
  type: Type
  properties?: { // Object has properties
    [key: string]: Field
  }
  required?: string[] // Key of required properties in object
  description?: string
  items?: { // Array has items. Define the item type
    type: ArrayItemType
  }
  enum?: string[] // Enum values
  additionalProperties?: false // Required in object by api. Just set false
}

export type StructuredOutput = {
  schema: {
    type: Type.object,
    properties: Record<string, Field>
    required: string[]
    additionalProperties: false
  }
}
