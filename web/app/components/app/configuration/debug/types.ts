export type ModelAndParameter = {
  model: string
  provider: string
  parameters: Record<string, any>
}

export type DebugWithSingleOrMultipleModelConfigs = {
  [k: string]: {
    multiple: boolean
    configs?: ModelAndParameter[]
  }
}
