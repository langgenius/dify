export type ModelAndParameter = {
  id: string
  model: string
  provider: string
  parameters: Record<string, any>
}

export type MultipleAndConfigs = {
  multiple: boolean
  configs: ModelAndParameter[]
}

export type DebugWithSingleOrMultipleModelConfigs = {
  [k: string]: MultipleAndConfigs
}
