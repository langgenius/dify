import type {
  Collection,
  Tool,
} from '@/app/components/tools/types'

export enum TabsEnum {
  Blocks = 'blocks',
  BuiltInTool = 'built-in-tool',
  CustomTool = 'custom-tool',
}

export enum BlockClassificationEnum {
  Default = '-',
  QuestionUnderstand = 'question-understand',
  Logic = 'logic',
  Transform = 'transform',
  Utilities = 'utilities',
}

export type CollectionWithExpanded = Collection & {
  expanded?: boolean
  fetching?: boolean
}

export type ToolInWorkflow = Tool
export type ToolsMap = Record<string, ToolInWorkflow[]>

export type ToolDefaultValue = {
  provider_id: string
  provider_type: string
  provider_name: string
  tool_name: string
  title: string
}
