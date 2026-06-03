import { AppModeEnum } from '@/types/app'

export function isWorkflowAppMode(mode?: string | null): mode is AppModeEnum.WORKFLOW {
  return mode === AppModeEnum.WORKFLOW
}

export function isWorkflowApp<T extends { mode?: string | null }>(app?: T): app is T & { mode: AppModeEnum.WORKFLOW } {
  return isWorkflowAppMode(app?.mode)
}
