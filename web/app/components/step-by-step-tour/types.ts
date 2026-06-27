import type { DocPathWithoutLang } from '@/types/doc-paths'

export const STEP_BY_STEP_TOUR_TASK_IDS = ['home', 'studio', 'knowledge', 'integration'] as const

export type StepByStepTourTaskId = typeof STEP_BY_STEP_TOUR_TASK_IDS[number]

export type StepByStepTourTaskStatus = 'completed' | 'current' | 'pending' | 'disabled'

export type StepByStepTourAccountState = {
  firstWorkspaceId?: string
  activeTaskId?: StepByStepTourTaskId
  manuallyEnabledWorkspaceIds: string[]
  manuallyDisabledWorkspaceIds: string[]
  minimized: boolean
  completedTaskIds: StepByStepTourTaskId[]
  skipped: boolean
}

export type StepByStepTourPermissionFallback
  = | 'show-parent-empty-state'
    | 'show-disabled-reason'

export type StepByStepTourTaskDefinition = {
  id: StepByStepTourTaskId
  route: string
  target: string
  iconClassName: string
  fallbackTarget?: string
  learnMoreDocPath?: DocPathWithoutLang
  canClickThrough: boolean
  permissionFallback?: StepByStepTourPermissionFallback
}

export type StepByStepTourTaskView = {
  id: StepByStepTourTaskId
  title: string
  description: string
  iconClassName: string
  status: StepByStepTourTaskStatus
  primaryActionLabel: string
  disabledReason?: string
  learnMoreLabel?: string
  learnMoreHref?: string
}
