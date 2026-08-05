import { AppModeEnum } from '@/types/app'

export type ModelAndParameter = {
  id: string
  model: string
  provider: string
  parameters: Record<string, any>
}

type MultipleAndConfigs = {
  multiple: boolean
  configs: ModelAndParameter[]
}

export type DebugWithSingleOrMultipleModelConfigs = {
  [k: string]: MultipleAndConfigs
}
export const APP_CHAT_WITH_MULTIPLE_MODEL = 'APP_CHAT_WITH_MULTIPLE_MODEL'
export const APP_CHAT_WITH_MULTIPLE_MODEL_RESTART = 'APP_CHAT_WITH_MULTIPLE_MODEL_RESTART'
export const ORCHESTRATE_CHANGED = 'ORCHESTRATE_CHANGED'
const DEBUG_ERROR_TOAST_OPTIONS = {
  position: { top: 60 },
} as const

export const getDebugErrorToastOptions = (mode: AppModeEnum) => {
  if (
    mode === AppModeEnum.CHAT ||
    mode === AppModeEnum.AGENT_CHAT ||
    mode === AppModeEnum.COMPLETION
  )
    return DEBUG_ERROR_TOAST_OPTIONS
}
