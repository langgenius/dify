'use client'

import type {
  StepByStepTourAccountState,
  StepByStepTourGuideGroup,
  StepByStepTourTaskId,
  StepByStepTourTaskStatus,
} from './types'
import { trackEvent } from '@/app/components/base/amplitude'

export const STEP_BY_STEP_TOUR_ANALYTICS_EVENTS = {
  cardToggled: 'tour_card_toggled',
  completed: 'tour_completed',
  dismissed: 'tour_dismissed',
  learnMoreClicked: 'tour_learn_more_clicked',
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

export type StepByStepTourStateSource = 'backend' | 'local_storage'

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
    | 'show_no_permission_guide'

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
  first_workspace_id?: string | null
  state_source: StepByStepTourStateSource
  workspace_scope: StepByStepTourWorkspaceScope
}

export type StepByStepTourTaskProperties = {
  task_id: StepByStepTourTaskId
}

export type StepByStepTourGuideProperties = StepByStepTourTaskProperties & {
  guide_group: StepByStepTourGuideGroup | null
  guide_plan_index: number
  guide_plan_total: number
  guide_raw_index: number
  guide_target: string
}

export type StepByStepTourShownProperties = StepByStepTourWorkspaceProperties & {
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
  step_label: string
}

export type StepByStepTourStepCtaClickedProperties = StepByStepTourWorkspaceProperties & StepByStepTourGuideProperties & {
  cta_label: string
  cta_type: 'complete_guide'
}

export type StepByStepTourStepCompletedProperties = StepByStepTourWorkspaceProperties & StepByStepTourGuideProperties & {
  completion_type: 'external_action' | 'guide_action'
  next_guide_target: string | null
}

export type StepByStepTourTaskCompletedProperties = StepByStepTourWorkspaceProperties & StepByStepTourTaskProperties & {
  completed_task_count: number
  completion_source: StepByStepTourTaskCompletionSource
  permission_variant: StepByStepTourPermissionVariant
  task_total: number
}

export type StepByStepTourCompletedProperties = StepByStepTourWorkspaceProperties & {
  completed_task_ids: readonly StepByStepTourTaskId[]
  duration_ms: number
  steps_done: number
  task_total: number
}

export type StepByStepTourSkippedProperties = StepByStepTourWorkspaceProperties & {
  active_task_id: StepByStepTourTaskId | null
  at_state: StepByStepTourCardState
  completed_task_count: number
  skip_scope: 'tour'
  source: 'floating_checklist'
}

export type StepByStepTourWalkthroughSkippedProperties = StepByStepTourWorkspaceProperties & StepByStepTourGuideProperties & {
  skip_scope: 'walkthrough'
}

export type StepByStepTourVisibilityToggledProperties = StepByStepTourWorkspaceProperties & {
  source: 'help_menu'
  to_state: 'off' | 'on'
  was_skipped: boolean
}

export type StepByStepTourCardToggledProperties = StepByStepTourWorkspaceProperties & {
  active_task_id: StepByStepTourTaskId | null
  completed_task_count: number
  source: 'auto_walkthrough_end' | 'auto_walkthrough_start' | 'user'
  to_state: StepByStepTourCardState
}

export type StepByStepTourTaskUncompletedProperties = StepByStepTourWorkspaceProperties & StepByStepTourTaskProperties & {
  completed_task_count_after: number
  completed_task_count_before: number
  source: 'checklist_status_control'
}

export type StepByStepTourPermissionFallbackViewedProperties = StepByStepTourWorkspaceProperties & StepByStepTourTaskProperties & {
  fallback_behavior: StepByStepTourPermissionFallbackBehavior
  guide_group: Extract<StepByStepTourGuideGroup, 'integrationLimitedAccess'> | null
  restriction: StepByStepTourPermissionRestriction
  role: StepByStepTourRole
}

export type StepByStepTourLearnMoreClickedProperties = StepByStepTourWorkspaceProperties & StepByStepTourTaskProperties & {
  doc_path: string
  guide_group: StepByStepTourGuideGroup | null
  guide_target: string | null
  source: 'checklist' | 'coachmark'
}

export type StepByStepTourDismissedProperties = StepByStepTourWorkspaceProperties & {
  active_task_id: StepByStepTourTaskId | null
  completed_task_count: number
  from_state: 'skip_recovery'
  source: 'recovery_prompt'
}

export type StepByStepTourAnalyticsPayloads = {
  tour_card_toggled: StepByStepTourCardToggledProperties
  tour_completed: StepByStepTourCompletedProperties
  tour_dismissed: StepByStepTourDismissedProperties
  tour_learn_more_clicked: StepByStepTourLearnMoreClickedProperties
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
  accountState,
  currentWorkspaceId,
  stateSource = 'local_storage',
}: {
  accountState: Pick<StepByStepTourAccountState, 'firstWorkspaceId' | 'manuallyDisabledWorkspaceIds' | 'manuallyEnabledWorkspaceIds'>
  currentWorkspaceId: string
  stateSource?: StepByStepTourStateSource
}): StepByStepTourWorkspaceProperties => ({
  current_workspace_id: currentWorkspaceId,
  first_workspace_id: accountState.firstWorkspaceId ?? null,
  state_source: stateSource,
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
  if (taskId === 'studio' && !canCreateApp)
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
