'use client'

import type { StepByStepTourGuide } from './target-registry'
import type { StepByStepTourAccountState, StepByStepTourGuideGroup, StepByStepTourPersistentState, StepByStepTourTaskId, StepByStepTourTaskView } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePathname, useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'
import {
  buildStepByStepTourScopedWorkspaceProperties,
  buildStepByStepTourWorkspaceProperties,
  getStepByStepTourPermissionVariant,
  getStepByStepTourWorkspaceScope,
  STEP_BY_STEP_TOUR_ANALYTICS_EVENTS,
  trackStepByStepTourEvent,
} from './analytics'
import { useSetStepByStepTourSkipRecoveryVisible, useStepByStepTourSkipRecoveryVisible } from './atoms'
import { StepByStepTourCoachmark } from './coachmark'
import { STEP_BY_STEP_TOUR_TASKS } from './constants'
import { FloatingChecklist } from './floating-widget'
import {
  getStepByStepTourEnabledForCurrentWorkspace,
  useSetStepByStepTourAccountState as useSetStepByStepTourAccount,
  useStepByStepTourAccountStateValue as useStepByStepTourAccountValue,
  useStepByStepTourStateActions,
} from './storage'
import {
  getStepByStepTourGuideInteractionPolicy,
  getStepByStepTourGuideKind,
  getStepByStepTourGuides,
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from './target-registry'
import { useStepByStepTourTarget } from './use-tour-target'

type StepByStepTourTask = (typeof STEP_BY_STEP_TOUR_TASKS)[number]

const hasCompletedAllStepByStepTourTasks = (
  completedTaskIds: StepByStepTourTaskId[],
  tasks: readonly StepByStepTourTask[],
) =>
  tasks.every(task => completedTaskIds.includes(task.id))

const getStepByStepTourTaskIndex = (
  taskId: StepByStepTourTaskId,
  tasks: readonly StepByStepTourTask[],
) =>
  tasks.findIndex(task => task.id === taskId)

const isPermissionFallbackGuideGroup = (
  guideGroup: StepByStepTourGuideGroup | undefined,
): guideGroup is Extract<StepByStepTourGuideGroup, 'homeNoCreate' | 'integrationLimitedAccess' | 'studioNoCreateEmpty' | 'studioNoCreateWithApps'> =>
  guideGroup === 'homeNoCreate'
  || guideGroup === 'integrationLimitedAccess'
  || guideGroup === 'studioNoCreateEmpty'
  || guideGroup === 'studioNoCreateWithApps'

const shouldHideOnPathname = (pathname: string) =>
  pathname.startsWith('/app/') || pathname.includes('/installed/')

const isOptionalGuideTargetAvailable = (guide: StepByStepTourGuide) => {
  if (!guide.optional)
    return true

  if (typeof document === 'undefined')
    return true

  return Boolean(document.querySelector(getStepByStepTourTargetSelector(guide.target)))
}

const createGuideIndexes = (guides: StepByStepTourGuide[]) =>
  guides.map((_, index) => index)

const getActiveGuideIndexes = (
  guides: StepByStepTourGuide[],
  guideIndexes: number[] | undefined,
) => {
  const fallbackGuideIndexes = createGuideIndexes(guides)

  if (!guideIndexes?.length)
    return fallbackGuideIndexes

  const validGuideIndexes = guideIndexes.filter(index => index >= 0 && index < guides.length)
  return validGuideIndexes.length > 0 ? validGuideIndexes : fallbackGuideIndexes
}

type StepByStepTourMountProps = {
  className?: string
}

export default function StepByStepTourMount({
  className,
}: StepByStepTourMountProps) {
  const router = useRouter()
  const pathname = usePathname()
  const docLink = useDocLink()
  const { t } = useTranslation('common')
  const { currentWorkspace, isCurrentWorkspaceManager, workspacePermissionKeys } = useAppContext()
  const { data: systemFeatures } = useQuery(systemFeaturesQueryOptions())
  const accountState = useStepByStepTourAccountValue()
  const setAccountState = useSetStepByStepTourAccount()
  // eslint-disable-next-line react/use-state -- Step-by-step tour state actions are not React useState calls.
  const stepByStepTourActions = useStepByStepTourStateActions()
  const skipRecoveryVisible = useStepByStepTourSkipRecoveryVisible()
  const setSkipRecoveryVisible = useSetStepByStepTourSkipRecoveryVisible()
  const anchorRef = useRef<HTMLDivElement>(null)
  const lastRequestedIntegrationRouteRef = useRef<string | undefined>(undefined)
  const previousSkippedRef = useRef(accountState.skipped)
  const permissionFallbackAnalyticsKeyRef = useRef<string | undefined>(undefined)
  const shownAnalyticsKeyRef = useRef<string | undefined>(undefined)
  const skipTimeoutRef = useRef<number | undefined>(undefined)
  const stepShownAnalyticsKeyRef = useRef<string | undefined>(undefined)
  const [checklistExiting, setChecklistExiting] = useState(false)
  const currentWorkspaceId = currentWorkspace.id
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const homeGuideGroup: Extract<StepByStepTourGuideGroup, 'homeNoCreate'> | undefined = canCreateApp
    ? undefined
    : 'homeNoCreate'
  const hasKnowledgeWalkthroughPermissions = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
    && hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const integrationGuideGroup: Extract<StepByStepTourGuideGroup, 'integrationLimitedAccess'> | undefined = isCurrentWorkspaceManager
    ? undefined
    : 'integrationLimitedAccess'
  const hasIntegrationWalkthroughPermissions = !integrationGuideGroup

  useEffect(() => () => {
    if (skipTimeoutRef.current)
      window.clearTimeout(skipTimeoutRef.current)
  }, [])

  const enabledForCurrentWorkspace = getStepByStepTourEnabledForCurrentWorkspace(accountState, currentWorkspaceId)
  const completedTaskIds = accountState.completedTaskIds
  const learnDifyEnabled = systemFeatures?.enable_learn_app ?? true
  const availableTasks = learnDifyEnabled
    ? STEP_BY_STEP_TOUR_TASKS
    : STEP_BY_STEP_TOUR_TASKS.filter(task => task.id !== 'home')
  const availableTaskIds = availableTasks.map(task => task.id)
  const completedAvailableTaskIds = completedTaskIds.filter(taskId => availableTaskIds.includes(taskId))
  const allTasksCompleted = hasCompletedAllStepByStepTourTasks(completedTaskIds, availableTasks)
  const currentTask = availableTasks.find(task => !completedTaskIds.includes(task.id))
  const activeTask = accountState.activeTaskId
    ? availableTasks.find(task => task.id === accountState.activeTaskId)
    : undefined
  const activeGuideGroup: StepByStepTourGuideGroup | undefined = activeTask?.id === 'home'
    ? homeGuideGroup
    : activeTask?.id === 'integration'
      ? integrationGuideGroup
      : accountState.activeGuideGroup
  const activeGuides = activeTask ? getStepByStepTourGuides(activeTask.id, activeGuideGroup) : []
  const activeGuideIndex = accountState.activeGuideIndex ?? 0
  const activeGuide = activeGuides[activeGuideIndex]
  const hasActiveGuide = Boolean(activeTask && activeGuide)
  const minimized = Boolean(activeTask) || accountState.minimized
  const activeGuideIndexes = activeGuides.length > 0
    ? getActiveGuideIndexes(activeGuides, accountState.activeGuideIndexes)
        .filter(index => isOptionalGuideTargetAvailable(activeGuides[index]!))
    : []
  const activeGuidePlanIndex = activeGuideIndexes.findIndex(index => index === activeGuideIndex)
  const activeStepIndex = activeGuideIndexes.length > 0
    ? activeGuidePlanIndex === -1
      ? activeGuideIndexes.filter(index => index < activeGuideIndex).length
      : activeGuidePlanIndex
    : activeGuideIndex
  const activeStepTotal = activeGuideIndexes.length || activeGuides.length
  const activeGuideAnalyticsProperties = activeTask && activeGuide
    ? {
        task_id: activeTask.id,
        guide_group: activeGuideGroup ?? null,
        guide_plan_index: activeStepIndex,
        guide_plan_total: activeStepTotal,
        guide_target: activeGuide.target,
      }
    : undefined
  const visible = IS_CLOUD_EDITION
    && enabledForCurrentWorkspace
    && (hasActiveGuide || !shouldHideOnPathname(pathname))
  const completionPromptVisible = visible
    && allTasksCompleted
    && !activeTask
  const checklistMinimized = completionPromptVisible ? false : minimized
  const expanded = !checklistMinimized
  const activeTargetElement = useStepByStepTourTarget(activeGuide?.target)
  const activeGuidePlacement = activeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.studioEmptyLearnDify
    ? 'top'
    : activeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.integration
      ? 'right'
      : 'bottom'
  const workspaceProperties = buildStepByStepTourWorkspaceProperties({ currentWorkspaceId })
  const scopedWorkspaceProperties = buildStepByStepTourScopedWorkspaceProperties({
    accountState,
    currentWorkspaceId,
  })

  const getPermissionVariant = (taskId: StepByStepTourTaskId) => getStepByStepTourPermissionVariant({
    canCreateApp,
    hasIntegrationWalkthroughPermissions,
    hasKnowledgeWalkthroughPermissions,
    taskId,
  })

  const getTaskStatus = (taskId: StepByStepTourTaskId) =>
    taskId === currentTask?.id ? 'current' : 'pending'

  const trackTaskCompleted = (
    persistentState: StepByStepTourPersistentState,
    taskId: StepByStepTourTaskId,
    completionSource: 'external_action' | 'manual' | 'permission_fallback' | 'walkthrough_finished',
  ) => {
    const completedAvailableTaskIds = persistentState.completedTaskIds.filter(completedTaskId => availableTaskIds.includes(completedTaskId))

    trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.taskCompleted, {
      ...workspaceProperties,
      task_id: taskId,
      completed_task_count: completedAvailableTaskIds.length,
      completion_source: completionSource,
      permission_variant: getPermissionVariant(taskId),
      task_total: availableTasks.length,
    })

    if (hasCompletedAllStepByStepTourTasks(persistentState.completedTaskIds, availableTasks)) {
      trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.completed, {
        ...buildStepByStepTourScopedWorkspaceProperties({
          accountState: persistentState,
          currentWorkspaceId,
        }),
        completed_task_ids: completedAvailableTaskIds,
        task_total: availableTasks.length,
      })
    }
  }

  const trackTourSkipped = (
    persistentState: StepByStepTourPersistentState,
    source: 'completion_prompt' | 'floating_checklist',
  ) => {
    trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.skipped, {
      ...workspaceProperties,
      active_task_id: activeTask?.id ?? null,
      at_state: source === 'completion_prompt'
        ? 'completion_prompt'
        : checklistMinimized ? 'minimized' : 'expanded',
      completed_task_count: persistentState.completedTaskIds.filter(taskId => availableTaskIds.includes(taskId)).length,
      skip_scope: 'tour',
      source,
    })
  }

  useEffect(() => {
    if (activeTask?.id !== 'integration' || !activeGuide?.integrationSection)
      return

    const activeGuideRoute = buildIntegrationPath(activeGuide.integrationSection)
    if (pathname === activeGuideRoute) {
      lastRequestedIntegrationRouteRef.current = undefined
      return
    }

    if (lastRequestedIntegrationRouteRef.current === activeGuideRoute)
      return

    lastRequestedIntegrationRouteRef.current = activeGuideRoute
    router.push(activeGuideRoute)
  }, [activeGuide?.integrationSection, activeTask?.id, pathname, router])

  useEffect(() => {
    activeTargetElement?.scrollIntoView?.({
      block: 'center',
      behavior: 'smooth',
    })
  }, [activeGuide?.target, activeTargetElement])

  useEffect(() => {
    if (!visible)
      return

    const triggerReason = previousSkippedRef.current
      ? 'reopen_after_skip'
      : getStepByStepTourWorkspaceScope({ accountState, currentWorkspaceId }) === 'first_workspace'
        ? 'first_workspace'
        : 'manual_open'
    const shownAnalyticsKey = `${currentWorkspaceId}:${triggerReason}`
    if (shownAnalyticsKeyRef.current === shownAnalyticsKey)
      return

    shownAnalyticsKeyRef.current = shownAnalyticsKey
    trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.shown, {
      ...scopedWorkspaceProperties,
      completed_task_count: completedAvailableTaskIds.length,
      initial_state: checklistMinimized ? 'minimized' : 'expanded',
      task_total: availableTasks.length,
      trigger_reason: triggerReason,
    })
  }, [
    accountState,
    availableTasks.length,
    checklistMinimized,
    completedAvailableTaskIds.length,
    currentWorkspaceId,
    scopedWorkspaceProperties,
    visible,
  ])

  useEffect(() => {
    if (!visible || !activeTask || !activeGuide || !activeTargetElement)
      return

    const guideAnalyticsProperties = {
      task_id: activeTask.id,
      guide_group: activeGuideGroup ?? null,
      guide_plan_index: activeStepIndex,
      guide_plan_total: activeStepTotal,
      guide_target: activeGuide.target,
    }

    const stepShownAnalyticsKey = [
      currentWorkspaceId,
      guideAnalyticsProperties.task_id,
      guideAnalyticsProperties.guide_group,
      guideAnalyticsProperties.guide_target,
      guideAnalyticsProperties.guide_plan_index,
    ].join(':')
    if (stepShownAnalyticsKeyRef.current === stepShownAnalyticsKey)
      return

    stepShownAnalyticsKeyRef.current = stepShownAnalyticsKey
    trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.stepShown, {
      ...workspaceProperties,
      ...guideAnalyticsProperties,
      interaction_policy: getStepByStepTourGuideInteractionPolicy(activeGuide, activeTask.canClickThrough),
    })
  }, [
    activeGuide,
    activeGuideGroup,
    activeStepIndex,
    activeStepTotal,
    activeTargetElement,
    activeTask,
    currentWorkspaceId,
    visible,
    workspaceProperties,
  ])

  useEffect(() => {
    if (!visible)
      return

    if (currentTask?.id === 'knowledge' && !hasKnowledgeWalkthroughPermissions) {
      const fallbackAnalyticsKey = `${currentWorkspaceId}:knowledge:no_knowledge_permission`
      if (permissionFallbackAnalyticsKeyRef.current === fallbackAnalyticsKey)
        return

      permissionFallbackAnalyticsKeyRef.current = fallbackAnalyticsKey
      trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.permissionFallbackViewed, {
        ...workspaceProperties,
        task_id: 'knowledge',
        fallback_behavior: 'mark_complete',
        guide_group: null,
        restriction: 'no_knowledge_permission',
        role: currentWorkspace.role,
      })
      return
    }

    if (!activeTask)
      return

    if (!isPermissionFallbackGuideGroup(activeGuideGroup))
      return

    const fallbackAnalyticsKey = `${currentWorkspaceId}:${activeTask.id}:${activeGuideGroup}`
    if (permissionFallbackAnalyticsKeyRef.current === fallbackAnalyticsKey)
      return

    permissionFallbackAnalyticsKeyRef.current = fallbackAnalyticsKey
    trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.permissionFallbackViewed, {
      ...workspaceProperties,
      task_id: activeTask.id,
      fallback_behavior: activeGuideGroup === 'integrationLimitedAccess' ? 'show_limited_access_guide' : 'show_no_create_guide',
      guide_group: activeGuideGroup,
      restriction: activeTask.id === 'integration' ? 'no_integration_permission' : 'no_create_permission',
      role: currentWorkspace.role,
    })
  }, [
    activeGuideGroup,
    activeTask,
    currentTask?.id,
    currentWorkspace.role,
    currentWorkspaceId,
    hasKnowledgeWalkthroughPermissions,
    visible,
    workspaceProperties,
  ])

  useEffect(() => {
    previousSkippedRef.current = accountState.skipped
  }, [accountState.skipped])

  if (!visible && !skipRecoveryVisible)
    return null
  const title = t('stepByStepTour.title')
  const taskCopy: Record<StepByStepTourTaskId, Pick<StepByStepTourTaskView, 'title' | 'description' | 'primaryActionLabel'>> = {
    home: {
      title: canCreateApp ? t('stepByStepTour.tasks.home.title') : t('stepByStepTour.tasks.home.noCreate.title'),
      description: canCreateApp ? t('stepByStepTour.tasks.home.description') : t('stepByStepTour.tasks.home.noCreate.description'),
      primaryActionLabel: t('stepByStepTour.tasks.home.primaryActionLabel'),
    },
    studio: {
      title: canCreateApp ? t('stepByStepTour.tasks.studio.title') : t('stepByStepTour.tasks.studio.noCreate.title'),
      description: canCreateApp ? t('stepByStepTour.tasks.studio.description') : t('stepByStepTour.tasks.studio.noCreate.description'),
      primaryActionLabel: t('stepByStepTour.tasks.studio.primaryActionLabel'),
    },
    knowledge: {
      title: hasKnowledgeWalkthroughPermissions ? t('stepByStepTour.tasks.knowledge.title') : t('stepByStepTour.tasks.knowledge.noPermission.title'),
      description: hasKnowledgeWalkthroughPermissions ? t('stepByStepTour.tasks.knowledge.description') : t('stepByStepTour.tasks.knowledge.noPermission.description'),
      primaryActionLabel: hasKnowledgeWalkthroughPermissions ? t('stepByStepTour.tasks.knowledge.primaryActionLabel') : t('stepByStepTour.tasks.knowledge.noPermission.primaryActionLabel'),
    },
    integration: {
      title: hasIntegrationWalkthroughPermissions ? t('stepByStepTour.tasks.integration.title') : t('stepByStepTour.tasks.integration.noPermission.title'),
      description: hasIntegrationWalkthroughPermissions ? t('stepByStepTour.tasks.integration.description') : t('stepByStepTour.tasks.integration.noPermission.description'),
      primaryActionLabel: t('stepByStepTour.tasks.integration.primaryActionLabel'),
    },
  }
  const tasks = availableTasks.map((task): StepByStepTourTaskView => {
    const completed = completedTaskIds.includes(task.id)
    const knowledgeUnavailable = task.id === 'knowledge' && !hasKnowledgeWalkthroughPermissions

    return {
      ...taskCopy[task.id],
      id: task.id,
      iconClassName: knowledgeUnavailable ? 'i-ri-lock-line' : task.iconClassName,
      status: completed
        ? 'completed'
        : task.id === currentTask?.id ? 'current' : 'pending',
      canToggleCompletion: false,
    }
  })

  const updateAccountState = (nextState: StepByStepTourAccountState) => {
    setAccountState(nextState)
  }

  const skipTour = () => {
    if (checklistExiting)
      return

    setChecklistExiting(true)

    skipTimeoutRef.current = window.setTimeout(() => {
      stepByStepTourActions.skipTour(currentWorkspaceId, {
        onSuccess: state => trackTourSkipped(state, 'floating_checklist'),
      })
      setChecklistExiting(false)
      setSkipRecoveryVisible(true)
    }, 160)
  }

  const skipActiveGuide = () => {
    const guideAnalyticsProperties = activeGuideAnalyticsProperties
    if (guideAnalyticsProperties) {
      trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.stepCtaClicked, {
        ...workspaceProperties,
        ...guideAnalyticsProperties,
        cta_type: 'skip_walkthrough',
      })
      trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.walkthroughSkipped, {
        ...workspaceProperties,
        ...guideAnalyticsProperties,
        skip_scope: 'walkthrough',
      })
    }

    updateAccountState({
      ...accountState,
      activeTaskId: undefined,
      activeGuideIndex: undefined,
      activeGuideGroup: undefined,
      activeGuideIndexes: undefined,
      minimized: true,
    })
  }

  const getNextVisibleActiveGuideIndex = (startIndex: number) => {
    if (activeGuideIndexes.length > 0) {
      let nextGuideIndexes = activeGuideIndexes
      let nextGuideIndex = nextGuideIndexes.find(index => index >= startIndex)

      while (nextGuideIndex !== undefined) {
        if (isOptionalGuideTargetAvailable(activeGuides[nextGuideIndex]!))
          return { activeGuideIndex: nextGuideIndex, activeGuideIndexes: nextGuideIndexes }

        nextGuideIndexes = nextGuideIndexes.filter(index => index !== nextGuideIndex)
        nextGuideIndex = nextGuideIndexes.find(index => index >= startIndex)
      }

      return { activeGuideIndex: -1, activeGuideIndexes: nextGuideIndexes }
    }

    for (let index = startIndex; index < activeGuides.length; index += 1) {
      if (isOptionalGuideTargetAvailable(activeGuides[index]!))
        return { activeGuideIndex: index, activeGuideIndexes: undefined }
    }

    return { activeGuideIndex: -1, activeGuideIndexes: undefined }
  }

  const completeActiveGuide = () => {
    if (!activeTask || !activeGuide)
      return

    if (activeGuide.completionMode === 'external')
      return

    const guideAnalyticsProperties = activeGuideAnalyticsProperties
    if (guideAnalyticsProperties) {
      trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.stepCtaClicked, {
        ...workspaceProperties,
        ...guideAnalyticsProperties,
        cta_type: 'complete_guide',
      })
    }

    if (activeGuideIndex < activeGuides.length - 1) {
      const nextActiveGuide = getNextVisibleActiveGuideIndex(activeGuideIndex + 1)

      if (nextActiveGuide.activeGuideIndex === -1) {
        if (guideAnalyticsProperties) {
          trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.stepCompleted, {
            ...workspaceProperties,
            ...guideAnalyticsProperties,
            next_guide_target: null,
          })
        }
        stepByStepTourActions.completeTask(activeTask.id, {
          onSuccess: state => trackTaskCompleted(state, activeTask.id, 'walkthrough_finished'),
        })
        updateAccountState({
          ...accountState,
          activeTaskId: undefined,
          activeGuideIndex: undefined,
          activeGuideGroup: undefined,
          activeGuideIndexes: undefined,
          minimized: false,
        })
        return
      }

      if (guideAnalyticsProperties) {
        trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.stepCompleted, {
          ...workspaceProperties,
          ...guideAnalyticsProperties,
          next_guide_target: activeGuides[nextActiveGuide.activeGuideIndex]?.target ?? null,
        })
      }
      updateAccountState({
        ...accountState,
        activeGuideIndex: nextActiveGuide.activeGuideIndex,
        activeGuideIndexes: nextActiveGuide.activeGuideIndexes,
        minimized: true,
      })
      return
    }

    if (guideAnalyticsProperties) {
      trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.stepCompleted, {
        ...workspaceProperties,
        ...guideAnalyticsProperties,
        next_guide_target: null,
      })
    }
    stepByStepTourActions.completeTask(activeTask.id, {
      onSuccess: state => trackTaskCompleted(state, activeTask.id, 'walkthrough_finished'),
    })
    updateAccountState({
      ...accountState,
      activeTaskId: undefined,
      activeGuideIndex: undefined,
      activeGuideGroup: undefined,
      activeGuideIndexes: undefined,
      minimized: false,
    })
  }

  const dismissCompletedTour = () => {
    stepByStepTourActions.skipTour(currentWorkspaceId, {
      onSuccess: state => trackTourSkipped(state, 'completion_prompt'),
    })
    updateAccountState({
      ...accountState,
      activeTaskId: undefined,
      activeGuideIndex: undefined,
      activeGuideGroup: undefined,
      activeGuideIndexes: undefined,
      minimized: false,
    })
  }

  const floatingChecklist = (
    <FloatingChecklist
      title={title}
      duration={t('stepByStepTour.duration')}
      minimized={checklistMinimized}
      progress={{
        ariaValueText: t('stepByStepTour.progressAriaValueText', {
          completed: completedAvailableTaskIds.length,
          total: availableTasks.length,
        }),
        completed: completedAvailableTaskIds.length,
        total: availableTasks.length,
      }}
      completionPrompt={completionPromptVisible
        ? {
            label: t('stepByStepTour.completion.label'),
            title: t('stepByStepTour.completion.title'),
            description: t('stepByStepTour.completion.description'),
            dismissLabel: t('stepByStepTour.completion.dismiss'),
            onDismiss: dismissCompletedTour,
          }
        : undefined}
      tasks={tasks}
      skipLabel={t('stepByStepTour.skip')}
      minimizeLabel={t('stepByStepTour.minimize')}
      restoreLabel={t('stepByStepTour.restore')}
      getTaskCompleteLabel={taskTitle => t('stepByStepTour.markTaskComplete', { title: taskTitle })}
      getTaskIncompleteLabel={taskTitle => t('stepByStepTour.markTaskIncomplete', { title: taskTitle })}
      onMinimize={() => updateAccountState({ ...accountState, minimized: true })}
      onRestore={() => updateAccountState({ ...accountState, minimized: false })}
      onSkip={skipTour}
      onCompleteTask={(taskId) => {
        const guides = getStepByStepTourGuides(taskId, accountState.activeGuideGroup)
        const hasExternalCompletionGuide = guides.some(guide => getStepByStepTourGuideKind(guide) === 'action')
        if (hasExternalCompletionGuide)
          return

        stepByStepTourActions.completeTask(taskId, {
          onSuccess: state => trackTaskCompleted(state, taskId, 'manual'),
        })
      }}
      onStartTask={(taskId) => {
        const task = availableTasks.find(item => item.id === taskId)

        if (!task)
          return

        const guideGroup = taskId === 'home'
          ? homeGuideGroup
          : taskId === 'integration'
            ? integrationGuideGroup
            : undefined
        trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.taskCtaClicked, {
          ...workspaceProperties,
          task_id: taskId,
          guide_group: guideGroup ?? null,
          permission_variant: getPermissionVariant(taskId),
          task_index: getStepByStepTourTaskIndex(taskId, availableTasks),
          task_status: getTaskStatus(taskId),
        })

        if (taskId === 'knowledge' && !hasKnowledgeWalkthroughPermissions) {
          stepByStepTourActions.completeTask(taskId, {
            onSuccess: state => trackTaskCompleted(state, taskId, 'permission_fallback'),
          })
          updateAccountState({
            ...accountState,
            activeTaskId: undefined,
            activeGuideIndex: undefined,
            activeGuideGroup: undefined,
            activeGuideIndexes: undefined,
            minimized: false,
          })
          return
        }

        const guides = getStepByStepTourGuides(taskId, guideGroup)
        updateAccountState({
          ...accountState,
          activeTaskId: taskId,
          activeGuideIndex: 0,
          activeGuideGroup: guideGroup,
          activeGuideIndexes: guides.length > 0 ? createGuideIndexes(guides) : undefined,
          minimized: true,
        })
        router.push(task.route)
      }}
      onUncompleteTask={(taskId) => {
        const completedTaskCountBefore = completedAvailableTaskIds.length
        stepByStepTourActions.uncompleteTask(taskId, {
          onSuccess: (state) => {
            trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.taskUncompleted, {
              ...workspaceProperties,
              task_id: taskId,
              completed_task_count_after: state.completedTaskIds.filter(completedTaskId => availableTaskIds.includes(completedTaskId)).length,
              completed_task_count_before: completedTaskCountBefore,
              source: 'checklist_status_control',
            })
          },
        })
      }}
      className={cn(
        'transition-opacity duration-150 ease-out motion-reduce:transition-none',
        checklistExiting && 'opacity-0',
      )}
    />
  )

  return (
    <div className={className}>
      {visible && !allTasksCompleted && activeTask && activeGuide && activeTargetElement && (
        <StepByStepTourCoachmark
          guide={{
            ...activeGuide,
            description: t(activeGuide.description),
            learnMoreHref: activeGuide.learnMoreDocPath ? docLink(activeGuide.learnMoreDocPath) : undefined,
            learnMoreLabel: t(activeGuide.learnMoreLabel),
            primaryActionLabel: t(activeGuide.primaryActionLabel),
            title: t(activeGuide.title),
          }}
          targetElement={activeTargetElement}
          placement={activeGuidePlacement}
          stepLabel={t('stepByStepTour.stepLabel', {
            current: activeStepIndex + 1,
            total: activeStepTotal,
          })}
          skipLabel={t('stepByStepTour.skip')}
          interactionPolicy={getStepByStepTourGuideInteractionPolicy(activeGuide, activeTask.canClickThrough)}
          onSkip={skipActiveGuide}
          onComplete={completeActiveGuide}
        />
      )}
      {visible && (!allTasksCompleted || completionPromptVisible) && (
        <Popover open={expanded}>
          <div ref={anchorRef} aria-hidden="true" className="h-0 w-0" />
          {minimized && floatingChecklist}
          <PopoverContent
            placement="top-start"
            sideOffset={8}
            positionerProps={{
              anchor: anchorRef,
              collisionPadding: 8,
              collisionAvoidance: {
                side: 'shift',
                align: 'shift',
                fallbackAxisSide: 'none',
              },
            }}
            popupClassName="max-h-[calc(100vh-16px)] overflow-y-auto rounded-none border-0 bg-transparent p-0 shadow-none"
          >
            {floatingChecklist}
          </PopoverContent>
        </Popover>
      )}
      {skipRecoveryVisible && (
        <SkipRecoveryPrompt
          label={t('stepByStepTour.skipRecovery.label')}
          message={t('stepByStepTour.skipRecovery.message')}
          dismissLabel={t('stepByStepTour.skipRecovery.dismiss')}
          onDismiss={() => setSkipRecoveryVisible(false)}
        />
      )}
    </div>
  )
}

function SkipRecoveryPrompt({
  dismissLabel,
  label,
  message,
  onDismiss,
}: {
  dismissLabel: string
  label: string
  message: string
  onDismiss: () => void
}) {
  const dismissRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    dismissRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <section
      aria-label={label}
      className="fixed bottom-[52px] left-1.5 z-50 flex w-[260px] max-w-[calc(100vw-12px)] flex-col gap-1 rounded-2xl border-[0.5px] border-state-accent-hover-alt bg-state-accent-hover p-4 shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)] backdrop-blur-[10px]"
    >
      <p className="system-sm-regular text-text-secondary">{message}</p>
      <div className="flex h-12 items-end justify-end pt-4">
        <Button ref={dismissRef} variant="primary" size="medium" className="w-20" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </div>
      <span aria-hidden className="absolute top-[140px] left-[214px] h-7 w-0.5 bg-state-accent-hover-alt" />
    </section>
  )
}
