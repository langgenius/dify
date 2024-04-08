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

export type ToolDefaultValue = {
  provider_id: string
  provider_type: string
  provider_name: string
  tool_name: string
  tool_label: string
  title: string
}
