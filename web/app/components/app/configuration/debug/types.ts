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
export const APP_CHAT_WITH_MULTIPLE_MODEL = 'APP_CHAT_WITH_MULTIPLE_MODEL'
export const APP_CHAT_WITH_MULTIPLE_MODEL_RESTART = 'APP_CHAT_WITH_MULTIPLE_MODEL_RESTART'
export const APP_SIDEBAR_SHOULD_COLLAPSE = 'APP_SIDEBAR_SHOULD_COLLAPSE'
export const ORCHESTRATE_CHANGED = 'ORCHESTRATE_CHANGED'
