import type { DocPathWithoutLang } from '@/types/doc-paths'

export const STEP_BY_STEP_TOUR_TASK_IDS = ['home', 'studio', 'knowledge', 'integration'] as const

export type StepByStepTourTaskId = typeof STEP_BY_STEP_TOUR_TASK_IDS[number]

export type StepByStepTourTaskStatus = 'completed' | 'current' | 'pending' | 'disabled'

export type StepByStepTourGuideGroup
  = 'homeNoCreate'
    | 'studioEmpty'
    | 'studioWithApps'
    | 'studioNoCreateEmpty'
    | 'studioNoCreateWithApps'
    | 'knowledgeEmpty'
    | 'knowledgeWithDatasets'
    | 'integrationLimitedAccess'

export type StepByStepTourAccountState = {
  firstWorkspaceId?: string
  updatedAt?: string | null
  manuallyEnabledWorkspaceIds: string[]
  manuallyDisabledWorkspaceIds: string[]
  completedTaskIds: StepByStepTourTaskId[]
  skipped: boolean
} & StepByStepTourUiState

export type StepByStepTourPersistentState = {
  firstWorkspaceId?: string
  updatedAt?: string | null
  manuallyEnabledWorkspaceIds: string[]
  manuallyDisabledWorkspaceIds: string[]
  completedTaskIds: StepByStepTourTaskId[]
  skipped: boolean
}

export type StepByStepTourUiState = {
  activeTaskId?: StepByStepTourTaskId
  activeGuideIndex?: number
  activeGuideGroup?: StepByStepTourGuideGroup
  activeGuideIndexes?: number[]
  minimized: boolean
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
  canToggleCompletion?: boolean
  learnMoreLabel?: string
  learnMoreHref?: string
}
