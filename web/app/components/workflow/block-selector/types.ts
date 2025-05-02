export enum TabsEnum {
  Blocks = 'blocks',
  Tools = 'tools',
}

export enum ToolTypeEnum {
  All = 'all',
  BuiltIn = 'built-in',
  Custom = 'custom',
  Workflow = 'workflow',
}

export enum BlockClassificationEnum {
  Default = '-',
  QuestionUnderstand = 'question-understand',
  Logic = 'logic',
  Transform = 'transform',
  Utilities = 'utilities',
}

export type ToolDefaultValue = {
  provider_id: string
  provider_type: string
  provider_name: string
  tool_name: string
  tool_label: string
  title: string
  is_team_authorization: boolean
  params: Record<string, any>
  paramSchemas: Record<string, any>[]
  output_schema: Record<string, any>
}

export type ToolValue = {
  provider_name: string
  tool_name: string
  tool_label: string
  settings?: Record<string, any>
  parameters?: Record<string, any>
  enabled?: boolean
  extra?: Record<string, any>
}
