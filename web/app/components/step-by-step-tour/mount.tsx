'use client'

import type { StepByStepTourAccountState, StepByStepTourTaskId, StepByStepTourTaskView } from './types'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { usePathname, useRouter } from '@/next/navigation'
import { StepByStepTourCoachmark } from './coachmark'
import { STEP_BY_STEP_TOUR_TASKS } from './constants'
import { FloatingChecklist } from './floating-widget'
import {
  useSetStepByStepTourAccountState as useSetStepByStepTourAccount,
  useStepByStepTourAccountStateValue as useStepByStepTourAccountValue,
} from './storage'
import { STEP_BY_STEP_TOUR_GUIDES } from './target-registry'
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
  const { currentWorkspace } = useAppContext()
  const accountState = useStepByStepTourAccountValue()
  const setAccountState = useSetStepByStepTourAccount()
  const anchorRef = useRef<HTMLDivElement>(null)
  const currentWorkspaceId = currentWorkspace.id

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
  const activeGuide = activeTask ? STEP_BY_STEP_TOUR_GUIDES[activeTask.id] : undefined
  const hasActiveGuide = Boolean(activeTask && activeGuide)
  const minimized = Boolean(activeTask) || accountState.minimized
  const expanded = !minimized
  const activeTaskIndex = activeTask
    ? STEP_BY_STEP_TOUR_TASKS.findIndex(task => task.id === activeTask.id)
    : -1
  const activeTaskLearnMoreHref = activeTask?.learnMoreDocPath
    ? docLink(activeTask.learnMoreDocPath)
    : undefined
  const visible = IS_CLOUD_EDITION
    && enabledForCurrentWorkspace
    && (hasActiveGuide || !shouldHideOnPathname(pathname))
  const activeTargetElement = useStepByStepTourTarget(activeGuide?.target)

  if (!visible)
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
      title: t('stepByStepTour.tasks.studio.title'),
      description: t('stepByStepTour.tasks.studio.description'),
      primaryActionLabel: t('stepByStepTour.tasks.studio.primaryActionLabel'),
    },
    knowledge: {
      title: t('stepByStepTour.tasks.knowledge.title'),
      description: t('stepByStepTour.tasks.knowledge.description'),
      primaryActionLabel: t('stepByStepTour.tasks.knowledge.primaryActionLabel'),
    },
    integration: {
      title: t('stepByStepTour.tasks.integration.title'),
      description: t('stepByStepTour.tasks.integration.description'),
      primaryActionLabel: t('stepByStepTour.tasks.integration.primaryActionLabel'),
    },
  }
  const tasks = STEP_BY_STEP_TOUR_TASKS.map((task): StepByStepTourTaskView => {
    const completed = completedTaskIds.includes(task.id)

    return {
      ...taskCopy[task.id],
      id: task.id,
      iconClassName: task.iconClassName,
      status: completed
        ? 'completed'
        : task.id === currentTask?.id ? 'current' : 'pending',
      learnMoreLabel,
      learnMoreHref: task.learnMoreDocPath ? docLink(task.learnMoreDocPath) : undefined,
    }
  })

  const updateAccountState = (nextState: StepByStepTourAccountState) => {
    setAccountState(nextState)
  }

  const completeActiveTask = () => {
    if (!activeTask)
      return

    updateAccountState({
      ...accountState,
      activeTaskId: undefined,
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
      onSkip={() => updateAccountState({
        ...accountState,
        skipped: true,
        manuallyEnabledWorkspaceIds: removeWorkspaceId(accountState.manuallyEnabledWorkspaceIds, currentWorkspaceId),
      })}
      onCompleteTask={(taskId) => {
        updateAccountState({
          ...accountState,
          completedTaskIds: addCompletedTask(accountState.completedTaskIds, taskId),
        })
      }}
      onStartTask={(taskId) => {
        const task = STEP_BY_STEP_TOUR_TASKS.find(item => item.id === taskId)

        if (!task)
          return

        updateAccountState({
          ...accountState,
          activeTaskId: taskId,
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
    />
  )

  return (
    <div className={className}>
      {activeTask && activeGuide && activeTargetElement && (
        <StepByStepTourCoachmark
          key={activeGuide.target}
          guide={activeGuide}
          targetElement={activeTargetElement}
          stepLabel={`${activeTaskIndex + 1} of ${STEP_BY_STEP_TOUR_TASKS.length}`}
          skipLabel={t('stepByStepTour.skip')}
          learnMoreHref={activeTaskLearnMoreHref}
          onSkip={() => updateAccountState({
            ...accountState,
            activeTaskId: undefined,
            minimized: true,
          })}
          onComplete={completeActiveTask}
        />
      )}
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
    </div>
  )
}
