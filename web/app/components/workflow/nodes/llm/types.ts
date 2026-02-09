import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { CommonNodeType, Memory, ModelConfig, PromptItem, PromptTemplateItem, ValueSelector, Variable, VisionSetting } from '@/app/components/workflow/types'

export type Tool = {
  enabled: boolean
  type: string
  provider_name: 'plugin' | 'builtin' | 'api' | 'workflow' | 'app' | 'dataset-retrieval'
  tool_name: string
  plugin_unique_identifier?: string
  credential_id?: string
  parameters?: Record<string, any>
  settings?: Record<string, any>
  extra?: Record<string, any>
}

export type ToolSetting = {
  type: string
  provider: string
  tool_name: string
  enabled: boolean
}

export type LLMNodeType = CommonNodeType & {
  model: ModelConfig
  prompt_template: PromptTemplateItem[] | PromptItem
  prompt_config?: {
    jinja2_variables?: Variable[]
  }
  memory?: Memory
  computer_use?: boolean
  context: {
    enabled: boolean
    variable_selector: ValueSelector
  }
  vision: {
    enabled: boolean
    configs?: VisionSetting
  }
  structured_output_enabled?: boolean
  structured_output?: StructuredOutput
  tools?: ToolValue[]
  tool_settings?: ToolSetting[]
  max_iterations?: number
}

export const FILE_REF_FORMAT = 'file-path'

export enum Type {
  string = 'string',
  number = 'number',
  boolean = 'boolean',
  object = 'object',
  array = 'array',
  arrayString = 'array[string]',
  arrayNumber = 'array[number]',
  arrayObject = 'array[object]',
  file = 'file',
  enumType = 'enum',
}

export enum ArrayType {
  string = 'array[string]',
  number = 'array[number]',
  boolean = 'array[boolean]',
  object = 'array[object]',
  file = 'array[file]',
}

export type TypeWithArray = Type | ArrayType

type ArrayItemType = Exclude<Type, Type.array>
export type ArrayItems = Omit<Field, 'type' | 'format'> & { type: ArrayItemType, format?: string }

export type SchemaEnumType = string[] | number[]

export type Field = {
  type: Type
  properties?: { // Object has properties
    [key: string]: Field
  }
  required?: string[] // Key of required properties in object
  description?: string
  format?: string
  items?: ArrayItems // Array has items. Define the item type
  enum?: SchemaEnumType // Enum values
  additionalProperties?: false // Required in object by api. Just set false
  schemaType?: string // an another type defined in backend schemas
}

export type StructuredOutput = {
  schema: SchemaRoot
}

export type SchemaRoot = {
  type: Type.object
  properties: Record<string, Field>
  required?: string[]
  additionalProperties: false
}
