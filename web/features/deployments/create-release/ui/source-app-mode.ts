import { AppModeEnum } from '@/types/app'

type WorkflowAppMode = Extract<AppModeEnum, 'workflow'>

export function isWorkflowAppMode(mode?: string | null): mode is WorkflowAppMode {
  return mode === AppModeEnum.WORKFLOW
}

export function isWorkflowApp<T extends { mode?: string | null }>(app?: T): app is T & { mode: WorkflowAppMode } {
  return isWorkflowAppMode(app?.mode)
}
