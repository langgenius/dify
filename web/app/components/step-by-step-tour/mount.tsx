'use client'

import type { StepByStepTourGuide } from './target-registry'
import type { StepByStepTourAccountState, StepByStepTourGuideGroup, StepByStepTourTaskId, StepByStepTourTaskView } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { usePathname, useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'
import { useSetStepByStepTourSkipRecoveryVisible, useStepByStepTourSkipRecoveryVisible } from './atoms'
import { StepByStepTourCoachmark } from './coachmark'
import { STEP_BY_STEP_TOUR_TASKS } from './constants'
import { FloatingChecklist } from './floating-widget'
import {
  useSetStepByStepTourAccountState as useSetStepByStepTourAccount,
  useStepByStepTourAccountStateValue as useStepByStepTourAccountValue,
} from './storage'
import {
  getStepByStepTourGuideInteractionPolicy,
  getStepByStepTourGuideKind,
  getStepByStepTourGuides,
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from './target-registry'
import { useStepByStepTourTarget } from './use-tour-target'

const addCompletedTask = (
  completedTaskIds: StepByStepTourTaskId[],
  taskId: StepByStepTourTaskId,
) => {
  if (completedTaskIds.includes(taskId))
    return completedTaskIds

  return [...completedTaskIds, taskId]
}

const removeCompletedTask = (
  completedTaskIds: StepByStepTourTaskId[],
  taskId: StepByStepTourTaskId,
) => completedTaskIds.filter(id => id !== taskId)

const removeWorkspaceId = (workspaceIds: string[], workspaceId: string) =>
  workspaceIds.filter(id => id !== workspaceId)

const getEnabledForCurrentWorkspace = (
  accountState: StepByStepTourAccountState,
  currentWorkspaceId: string,
) => !accountState.skipped
  && !accountState.manuallyDisabledWorkspaceIds.includes(currentWorkspaceId)
  && (
    accountState.firstWorkspaceId === currentWorkspaceId
    || accountState.manuallyEnabledWorkspaceIds.includes(currentWorkspaceId)
  )

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
  const accountState = useStepByStepTourAccountValue()
  const setAccountState = useSetStepByStepTourAccount()
  const skipRecoveryVisible = useStepByStepTourSkipRecoveryVisible()
  const setSkipRecoveryVisible = useSetStepByStepTourSkipRecoveryVisible()
  const anchorRef = useRef<HTMLDivElement>(null)
  const lastRequestedIntegrationRouteRef = useRef<string | undefined>(undefined)
  const skipTimeoutRef = useRef<number | undefined>(undefined)
  const [checklistExiting, setChecklistExiting] = useState(false)
  const currentWorkspaceId = currentWorkspace.id
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const hasKnowledgeWalkthroughPermissions = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
    && hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const integrationGuideGroup: Extract<StepByStepTourGuideGroup, 'integrationEditor' | 'integrationNoPermission'> | undefined = isCurrentWorkspaceManager
    ? undefined
    : currentWorkspace.role === 'editor' ? 'integrationEditor' : 'integrationNoPermission'
  const hasIntegrationWalkthroughPermissions = integrationGuideGroup !== 'integrationNoPermission'

  useEffect(() => () => {
    if (skipTimeoutRef.current)
      window.clearTimeout(skipTimeoutRef.current)
  }, [])

  useEffect(() => {
    if (accountState.firstWorkspaceId)
      return

    setAccountState({
      ...accountState,
      firstWorkspaceId: currentWorkspaceId,
    })
  }, [accountState, currentWorkspaceId, setAccountState])

  const enabledForCurrentWorkspace = getEnabledForCurrentWorkspace(accountState, currentWorkspaceId)
  const completedTaskIds = accountState.completedTaskIds
  const currentTask = STEP_BY_STEP_TOUR_TASKS.find(task => !completedTaskIds.includes(task.id))
  const activeTask = accountState.activeTaskId
    ? STEP_BY_STEP_TOUR_TASKS.find(task => task.id === accountState.activeTaskId)
    : undefined
  const activeGuideGroup: StepByStepTourGuideGroup | undefined = activeTask?.id === 'integration'
    ? integrationGuideGroup
    : accountState.activeGuideGroup
  const activeGuides = activeTask ? getStepByStepTourGuides(activeTask.id, activeGuideGroup) : []
  const activeGuideIndex = accountState.activeGuideIndex ?? 0
  const activeGuide = activeGuides[activeGuideIndex]
  const hasActiveGuide = Boolean(activeTask && activeGuide)
  const minimized = Boolean(activeTask) || accountState.minimized
  const expanded = !minimized
  const activeTaskIndex = activeTask
    ? STEP_BY_STEP_TOUR_TASKS.findIndex(task => task.id === activeTask.id)
    : -1
  const usesGuideStepCount = activeGuides.length > 1
    || activeGuideGroup === 'integrationNoPermission'
  const usesGuideIndexPlan = activeTask?.id === 'integration' && usesGuideStepCount
  const activeGuideIndexes = usesGuideIndexPlan
    ? getActiveGuideIndexes(activeGuides, accountState.activeGuideIndexes)
    : []
  const activeGuidePlanIndex = activeGuideIndexes.findIndex(index => index === activeGuideIndex)
  const fallbackActiveStepTotal = activeTask?.id === 'integration'
    ? activeGuides.length
    : activeGuides.filter(guide => isOptionalGuideTargetAvailable(guide)).length
  const activeStepIndex = usesGuideIndexPlan
    ? activeGuidePlanIndex === -1
      ? activeGuideIndexes.filter(index => index < activeGuideIndex).length
      : activeGuidePlanIndex
    : usesGuideStepCount ? activeGuideIndex : activeTaskIndex
  const activeStepTotal = usesGuideStepCount
    ? usesGuideIndexPlan ? activeGuideIndexes.length : fallbackActiveStepTotal
    : STEP_BY_STEP_TOUR_TASKS.length
  const visible = IS_CLOUD_EDITION
    && enabledForCurrentWorkspace
    && (hasActiveGuide || !shouldHideOnPathname(pathname))
  const activeTargetElement = useStepByStepTourTarget(activeGuide?.target)
  const activeGuidePlacement = activeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.studioEmptyLearnDify
    ? 'top'
    : activeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.integration
      ? 'right'
      : 'bottom'

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

  if (!visible && !skipRecoveryVisible)
    return null
  const title = t('stepByStepTour.title')
  const learnMoreLabel = t('stepByStepTour.learnMore')
  const taskCopy: Record<StepByStepTourTaskId, Pick<StepByStepTourTaskView, 'title' | 'description' | 'primaryActionLabel'>> = {
    home: {
      title: t('stepByStepTour.tasks.home.title'),
      description: t('stepByStepTour.tasks.home.description'),
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
      title: t('stepByStepTour.tasks.integration.title'),
      description: hasIntegrationWalkthroughPermissions ? t('stepByStepTour.tasks.integration.description') : t('stepByStepTour.tasks.integration.noPermission.description'),
      primaryActionLabel: t('stepByStepTour.tasks.integration.primaryActionLabel'),
    },
  }
  const tasks = STEP_BY_STEP_TOUR_TASKS.map((task): StepByStepTourTaskView => {
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
      learnMoreLabel,
      learnMoreHref: task.learnMoreDocPath ? docLink(task.learnMoreDocPath) : undefined,
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
      updateAccountState({
        ...accountState,
        skipped: true,
        manuallyEnabledWorkspaceIds: removeWorkspaceId(accountState.manuallyEnabledWorkspaceIds, currentWorkspaceId),
      })
      setChecklistExiting(false)
      setSkipRecoveryVisible(true)
    }, 160)
  }

  const skipActiveGuide = () => {
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
    if (usesGuideIndexPlan) {
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

    if (activeGuideIndex < activeGuides.length - 1) {
      const nextActiveGuide = getNextVisibleActiveGuideIndex(activeGuideIndex + 1)

      if (nextActiveGuide.activeGuideIndex === -1) {
        updateAccountState({
          ...accountState,
          activeTaskId: undefined,
          activeGuideIndex: undefined,
          activeGuideGroup: undefined,
          activeGuideIndexes: undefined,
          completedTaskIds: addCompletedTask(accountState.completedTaskIds, activeTask.id),
          minimized: false,
        })
        return
      }

      updateAccountState({
        ...accountState,
        activeGuideIndex: nextActiveGuide.activeGuideIndex,
        activeGuideIndexes: nextActiveGuide.activeGuideIndexes,
        minimized: true,
      })
      return
    }

    updateAccountState({
      ...accountState,
      activeTaskId: undefined,
      activeGuideIndex: undefined,
      activeGuideGroup: undefined,
      activeGuideIndexes: undefined,
      completedTaskIds: addCompletedTask(accountState.completedTaskIds, activeTask.id),
      minimized: false,
    })
  }

  const floatingChecklist = (
    <FloatingChecklist
      title={title}
      duration={t('stepByStepTour.duration')}
      minimized={minimized}
      progress={{
        completed: completedTaskIds.length,
        total: STEP_BY_STEP_TOUR_TASKS.length,
      }}
      tasks={tasks}
      skipLabel={t('stepByStepTour.skip')}
      minimizeLabel={t('stepByStepTour.minimize')}
      restoreLabel={t('stepByStepTour.restore')}
      onMinimize={() => updateAccountState({ ...accountState, minimized: true })}
      onRestore={() => updateAccountState({ ...accountState, minimized: false })}
      onSkip={skipTour}
      onCompleteTask={(taskId) => {
        const guides = getStepByStepTourGuides(taskId, accountState.activeGuideGroup)
        const hasExternalCompletionGuide = guides.some(guide => getStepByStepTourGuideKind(guide) === 'action')
        if (hasExternalCompletionGuide)
          return

        updateAccountState({
          ...accountState,
          completedTaskIds: addCompletedTask(accountState.completedTaskIds, taskId),
        })
      }}
      onStartTask={(taskId) => {
        const task = STEP_BY_STEP_TOUR_TASKS.find(item => item.id === taskId)

        if (!task)
          return

        if (taskId === 'knowledge' && !hasKnowledgeWalkthroughPermissions) {
          updateAccountState({
            ...accountState,
            activeTaskId: undefined,
            activeGuideIndex: undefined,
            activeGuideGroup: undefined,
            activeGuideIndexes: undefined,
            completedTaskIds: addCompletedTask(accountState.completedTaskIds, taskId),
            minimized: false,
          })
          return
        }

        if (taskId === 'studio' && !canCreateApp) {
          updateAccountState({
            ...accountState,
            activeTaskId: undefined,
            activeGuideIndex: undefined,
            activeGuideGroup: undefined,
            activeGuideIndexes: undefined,
            completedTaskIds: addCompletedTask(accountState.completedTaskIds, taskId),
            minimized: false,
          })
          router.push(task.route)
          return
        }

        const guideGroup = taskId === 'integration' ? integrationGuideGroup : undefined
        const guides = getStepByStepTourGuides(taskId, guideGroup)
        const usesTaskGuideStepCount = taskId === 'integration'
          && (guides.length > 1 || guideGroup === 'integrationNoPermission')

        updateAccountState({
          ...accountState,
          activeTaskId: taskId,
          activeGuideIndex: 0,
          activeGuideGroup: guideGroup,
          activeGuideIndexes: usesTaskGuideStepCount ? createGuideIndexes(guides) : undefined,
          minimized: true,
        })
        router.push(task.route)
      }}
      onUncompleteTask={(taskId) => {
        updateAccountState({
          ...accountState,
          completedTaskIds: removeCompletedTask(accountState.completedTaskIds, taskId),
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
      {visible && activeTask && activeGuide && activeTargetElement && (
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
          stepLabel={`${activeStepIndex + 1} of ${activeStepTotal}`}
          skipLabel={t('stepByStepTour.skip')}
          interactionPolicy={getStepByStepTourGuideInteractionPolicy(activeGuide, activeTask.canClickThrough)}
          onSkip={skipActiveGuide}
          onComplete={completeActiveGuide}
        />
      )}
      {visible && (
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
      className="fixed bottom-[52px] left-1.5 z-50 flex w-[260px] max-w-[calc(100vw-12px)] flex-col gap-1 rounded-2xl border-[0.5px] border-state-base-hover-alt p-4 shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)] backdrop-blur-[10px]"
      style={{
        background: 'linear-gradient(rgb(255 255 255 / 90%), rgb(255 255 255 / 90%)), #e9f0ff',
      }}
    >
      <p className="system-sm-regular text-text-secondary">{message}</p>
      <div className="flex h-12 items-end justify-end pt-4">
        <Button ref={dismissRef} variant="primary" size="medium" className="w-20" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </div>
      <span aria-hidden className="absolute top-[140px] left-[214px] h-7 w-0.5 bg-state-base-hover-alt" />
    </section>
  )
}
