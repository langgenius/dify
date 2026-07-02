'use client'

import type {
  StepByStepTourAccountState,
  StepByStepTourGuideGroup,
  StepByStepTourTaskId,
  StepByStepTourTaskStatus,
} from './types'
import { trackEvent } from '@/app/components/base/amplitude'

export const STEP_BY_STEP_TOUR_ANALYTICS_EVENTS = {
  completed: 'tour_completed',
  permissionFallbackViewed: 'tour_permission_fallback_viewed',
  shown: 'tour_shown',
  skipped: 'tour_skipped',
  stepCompleted: 'tour_step_completed',
  stepCtaClicked: 'tour_step_cta_clicked',
  stepShown: 'tour_step_shown',
  taskCompleted: 'tour_task_completed',
  taskCtaClicked: 'tour_task_cta_clicked',
  taskUncompleted: 'tour_task_uncompleted',
  visibilityToggled: 'tour_visibility_toggled',
  walkthroughSkipped: 'tour_walkthrough_skipped',
} as const

export type StepByStepTourAnalyticsEventName
  = typeof STEP_BY_STEP_TOUR_ANALYTICS_EVENTS[keyof typeof STEP_BY_STEP_TOUR_ANALYTICS_EVENTS]

export type StepByStepTourWorkspaceScope
  = | 'disabled_workspace'
    | 'first_workspace'
    | 'manual_enabled_workspace'
    | 'other_workspace'

export type StepByStepTourPermissionVariant
  = | 'full'
    | 'no_create'
    | 'no_integration_permission'
    | 'no_knowledge_permission'

export type StepByStepTourTriggerReason
  = | 'first_workspace'
    | 'manual_open'
    | 'reopen_after_skip'

export type StepByStepTourCardState = 'expanded' | 'minimized'

export type StepByStepTourTourState = StepByStepTourCardState | 'completion_prompt'

export type StepByStepTourGuideInteractionPolicy = 'blocked' | 'target-only'

export type StepByStepTourTaskCompletionSource
  = | 'external_action'
    | 'manual'
    | 'permission_fallback'
    | 'walkthrough_finished'

export type StepByStepTourPermissionRestriction
  = | 'no_create_permission'
    | 'no_integration_permission'
    | 'no_knowledge_permission'

export type StepByStepTourPermissionFallbackBehavior
  = | 'mark_complete'
    | 'show_limited_access_guide'
    | 'show_no_create_guide'

export type StepByStepTourRole
  = | 'admin'
    | 'dataset_operator'
    | 'editor'
    | 'normal'
    | 'owner'
    | (string & {})

type StepByStepTourAnalyticsValue
  = | boolean
    | null
    | number
    | readonly string[]
    | string

export type StepByStepTourAnalyticsProperties = Record<string, StepByStepTourAnalyticsValue | undefined>

export type StepByStepTourWorkspaceProperties = {
  current_workspace_id: string
}

export type StepByStepTourScopedWorkspaceProperties = StepByStepTourWorkspaceProperties & {
  workspace_scope: StepByStepTourWorkspaceScope
}

export type StepByStepTourTaskProperties = {
  task_id: StepByStepTourTaskId
}

export type StepByStepTourGuideProperties = StepByStepTourTaskProperties & {
  guide_group: StepByStepTourGuideGroup | null
  guide_plan_index: number
  guide_plan_total: number
  guide_target: string
}

export type StepByStepTourShownProperties = StepByStepTourScopedWorkspaceProperties & {
  completed_task_count: number
  initial_state: StepByStepTourCardState
  task_total: number
  trigger_reason: StepByStepTourTriggerReason
}

export type StepByStepTourTaskCtaClickedProperties = StepByStepTourWorkspaceProperties & StepByStepTourTaskProperties & {
  guide_group: StepByStepTourGuideGroup | null
  permission_variant: StepByStepTourPermissionVariant
  task_index: number
  task_status: Extract<StepByStepTourTaskStatus, 'current' | 'pending'>
}

export type StepByStepTourStepShownProperties = StepByStepTourWorkspaceProperties & StepByStepTourGuideProperties & {
  interaction_policy: StepByStepTourGuideInteractionPolicy
}

export type StepByStepTourStepCtaClickedProperties = StepByStepTourWorkspaceProperties & StepByStepTourGuideProperties & {
  cta_type: 'complete_guide' | 'skip_walkthrough'
}

export type StepByStepTourStepCompletedProperties = StepByStepTourWorkspaceProperties & StepByStepTourGuideProperties & {
  next_guide_target: string | null
}

export type StepByStepTourTaskCompletedProperties = StepByStepTourWorkspaceProperties & StepByStepTourTaskProperties & {
  completed_task_count: number
  completion_source: StepByStepTourTaskCompletionSource
  permission_variant: StepByStepTourPermissionVariant
  task_total: number
}

export type StepByStepTourCompletedProperties = StepByStepTourScopedWorkspaceProperties & {
  completed_task_ids: readonly StepByStepTourTaskId[]
  task_total: number
}

export type StepByStepTourSkippedProperties = StepByStepTourWorkspaceProperties & {
  active_task_id: StepByStepTourTaskId | null
  at_state: StepByStepTourTourState
  completed_task_count: number
  skip_scope: 'tour'
  source: 'completion_prompt' | 'floating_checklist'
}

export type StepByStepTourWalkthroughSkippedProperties = StepByStepTourWorkspaceProperties & StepByStepTourGuideProperties & {
  skip_scope: 'walkthrough'
}

export type StepByStepTourVisibilityToggledProperties = StepByStepTourWorkspaceProperties & {
  source: 'help_menu'
  to_state: 'off' | 'on'
  was_skipped: boolean
}

export type StepByStepTourTaskUncompletedProperties = StepByStepTourWorkspaceProperties & StepByStepTourTaskProperties & {
  completed_task_count_after: number
  completed_task_count_before: number
  source: 'checklist_status_control'
}

export type StepByStepTourPermissionFallbackViewedProperties = StepByStepTourWorkspaceProperties & StepByStepTourTaskProperties & {
  fallback_behavior: StepByStepTourPermissionFallbackBehavior
  guide_group: Extract<StepByStepTourGuideGroup, 'homeNoCreate' | 'integrationLimitedAccess' | 'studioNoCreateEmpty' | 'studioNoCreateWithApps'> | null
  restriction: StepByStepTourPermissionRestriction
  role: StepByStepTourRole
}

export type StepByStepTourAnalyticsPayloads = {
  tour_completed: StepByStepTourCompletedProperties
  tour_permission_fallback_viewed: StepByStepTourPermissionFallbackViewedProperties
  tour_shown: StepByStepTourShownProperties
  tour_skipped: StepByStepTourSkippedProperties
  tour_step_completed: StepByStepTourStepCompletedProperties
  tour_step_cta_clicked: StepByStepTourStepCtaClickedProperties
  tour_step_shown: StepByStepTourStepShownProperties
  tour_task_completed: StepByStepTourTaskCompletedProperties
  tour_task_cta_clicked: StepByStepTourTaskCtaClickedProperties
  tour_task_uncompleted: StepByStepTourTaskUncompletedProperties
  tour_visibility_toggled: StepByStepTourVisibilityToggledProperties
  tour_walkthrough_skipped: StepByStepTourWalkthroughSkippedProperties
}

export const getStepByStepTourWorkspaceScope = ({
  accountState,
  currentWorkspaceId,
}: {
  accountState: Pick<StepByStepTourAccountState, 'firstWorkspaceId' | 'manuallyDisabledWorkspaceIds' | 'manuallyEnabledWorkspaceIds'>
  currentWorkspaceId: string
}): StepByStepTourWorkspaceScope => {
  if (accountState.firstWorkspaceId === currentWorkspaceId)
    return 'first_workspace'

  if (accountState.manuallyEnabledWorkspaceIds.includes(currentWorkspaceId))
    return 'manual_enabled_workspace'

  if (accountState.manuallyDisabledWorkspaceIds.includes(currentWorkspaceId))
    return 'disabled_workspace'

  return 'other_workspace'
}

export const buildStepByStepTourWorkspaceProperties = ({
  currentWorkspaceId,
}: {
  currentWorkspaceId: string
}): StepByStepTourWorkspaceProperties => ({
  current_workspace_id: currentWorkspaceId,
})

export const buildStepByStepTourScopedWorkspaceProperties = ({
  accountState,
  currentWorkspaceId,
}: {
  accountState: Pick<StepByStepTourAccountState, 'firstWorkspaceId' | 'manuallyDisabledWorkspaceIds' | 'manuallyEnabledWorkspaceIds'>
  currentWorkspaceId: string
}): StepByStepTourScopedWorkspaceProperties => ({
  ...buildStepByStepTourWorkspaceProperties({ currentWorkspaceId }),
  workspace_scope: getStepByStepTourWorkspaceScope({
    accountState,
    currentWorkspaceId,
  }),
})

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
  if ((taskId === 'home' || taskId === 'studio') && !canCreateApp)
    return 'no_create'

  if (taskId === 'knowledge' && !hasKnowledgeWalkthroughPermissions)
    return 'no_knowledge_permission'

  if (taskId === 'integration' && !hasIntegrationWalkthroughPermissions)
    return 'no_integration_permission'

  return 'full'
}

const toTrackEventProperties = (
  properties: StepByStepTourAnalyticsProperties,
) => Object.fromEntries(
  Object.entries(properties).filter(([, value]) => value !== undefined),
) as Record<string, StepByStepTourAnalyticsValue>

export const trackStepByStepTourEvent = <EventName extends StepByStepTourAnalyticsEventName>(
  eventName: EventName,
  properties: StepByStepTourAnalyticsPayloads[EventName],
) => {
  trackEvent(eventName, toTrackEventProperties(properties as StepByStepTourAnalyticsProperties))
}
