import type { StepByStepTourStateResponse } from '@dify/contracts/api/console/onboarding/types.gen'
import type { DocPathWithoutLang } from '@/types/doc-paths'

export type StepByStepTourTaskId = NonNullable<
  StepByStepTourStateResponse['completed_task_ids']
>[number]

type StepByStepTourTaskStatus = 'completed' | 'current' | 'pending' | 'disabled'

export type StepByStepTourGuideGroup =
  | 'homeNoCreate'
  | 'studioEmpty'
  | 'studioWithApps'
  | 'studioNoCreateEmpty'
  | 'studioNoCreateWithApps'
  | 'knowledgeEmpty'
  | 'knowledgeWithDatasets'
  | 'integrationLimitedAccess'

export type StepByStepTourSessionState = {
  activeTaskId?: StepByStepTourTaskId
  activeGuideIndex?: number
  activeGuideGroup?: StepByStepTourGuideGroup
  activeGuideIndexes?: number[]
}

type StepByStepTourPermissionFallback = 'show-parent-empty-state' | 'show-disabled-reason'

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
