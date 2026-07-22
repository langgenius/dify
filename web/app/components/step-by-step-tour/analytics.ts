'use client'

import type { StepByStepTourTaskId } from './types'
import { trackEvent } from '@/app/components/base/amplitude'

const STEP_BY_STEP_TOUR_ANALYTICS_EVENT = 'step_tour'

export type StepByStepTourPermissionVariant =
  | 'full'
  | 'no_create'
  | 'no_integration_permission'
  | 'no_knowledge_permission'

type StepByStepTourAction =
  | 'guide_completed'
  | 'guide_shown'
  | 'guide_skipped'
  | 'permission_fallback_shown'
  | 'task_completed'
  | 'task_reopened'
  | 'task_started'
  | 'tour_completed'
  | 'tour_disabled'
  | 'tour_enabled'
  | 'tour_shown'
  | 'tour_skipped'

type StepByStepTourEntryPoint = 'first_workspace' | 'help_menu_enabled' | 'reenabled_after_skip'

type StepByStepTourHomeOutcome = 'lesson_app_created' | 'lesson_opened'

type StepByStepTourAnalyticsValue = number | string

export type StepByStepTourAnalyticsProperties = {
  action: StepByStepTourAction
  completed_task_count?: number
  entry_point?: StepByStepTourEntryPoint
  guide_id?: string
  home_outcome?: StepByStepTourHomeOutcome
  permission_variant?: StepByStepTourPermissionVariant
  task_id?: StepByStepTourTaskId
  task_total?: number
}

export const getStepByStepTourPermissionVariant = ({
  canCreateApp,
  hasIntegrationWalkthroughPermissions,
  hasKnowledgeWalkthroughPermissions,
  taskId,
}: {
  canCreateApp: boolean
  hasIntegrationWalkthroughPermissions: boolean
  hasKnowledgeWalkthroughPermissions: boolean
  taskId: StepByStepTourTaskId
}): StepByStepTourPermissionVariant => {
  if ((taskId === 'home' || taskId === 'studio') && !canCreateApp) return 'no_create'

  if (taskId === 'knowledge' && !hasKnowledgeWalkthroughPermissions)
    return 'no_knowledge_permission'

  if (taskId === 'integration' && !hasIntegrationWalkthroughPermissions)
    return 'no_integration_permission'

  return 'full'
}

const toTrackEventProperties = (properties: StepByStepTourAnalyticsProperties) =>
  Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  ) as Record<string, StepByStepTourAnalyticsValue>

export const trackStepByStepTourEvent = (properties: StepByStepTourAnalyticsProperties) => {
  trackEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENT, toTrackEventProperties(properties))
}
