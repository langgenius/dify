export const STEP_BY_STEP_TOUR_TASK_IDS = ['home', 'studio', 'knowledge', 'integration'] as const

export type StepByStepTourTaskId = typeof STEP_BY_STEP_TOUR_TASK_IDS[number]

export type StepByStepTourAccountState = {
  firstWorkspaceId?: string
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
  fallbackTarget?: string
  canClickThrough: boolean
  permissionFallback?: StepByStepTourPermissionFallback
}
