import type { App, AppModeEnum } from '@/types/app'

export type GuideMethod = 'bindApp' | 'importDsl'
export type GuideStep = 'source' | 'release' | 'target'
export type WorkflowSourceApp = App & { mode: Extract<AppModeEnum, 'workflow'> }
