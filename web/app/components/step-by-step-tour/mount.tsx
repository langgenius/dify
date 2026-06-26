'use client'

import type { StepByStepTourAccountState, StepByStepTourTaskId, StepByStepTourTaskView } from './types'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { useRef } from 'react'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { usePathname, useRouter } from '@/next/navigation'
import { STEP_BY_STEP_TOUR_TASKS } from './constants'
import { FloatingChecklist } from './floating-widget'
import {
  useSetStepByStepTourAccountState,
  useStepByStepTourAccountStateValue,
} from './storage'

const title = 'Step-by-step Tour'
const duration = 'about 5 minutes'
const skipLabel = 'Skip'
const minimizeLabel = 'Minimize tour'
const restoreLabel = 'Open step-by-step tour'
const primaryActionLabel = 'Start'
const learnMoreLabel = 'Learn more'

const taskCopy: Record<StepByStepTourTaskId, Pick<StepByStepTourTaskView, 'title' | 'description'>> = {
  home: {
    title: 'Home',
    description: 'Learn the basics and find starter resources.',
  },
  studio: {
    title: 'Studio',
    description: 'Create and manage your first AI app.',
  },
  knowledge: {
    title: 'Knowledge',
    description: 'Add data sources for better answers.',
  },
  integration: {
    title: 'Integrations',
    description: 'Connect providers, tools, and extensions.',
  },
}

const addCompletedTask = (
  completedTaskIds: StepByStepTourTaskId[],
  taskId: StepByStepTourTaskId,
) => {
  if (completedTaskIds.includes(taskId))
    return completedTaskIds

  return [...completedTaskIds, taskId]
}

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
  const { currentWorkspace } = useAppContext()
  const accountState = useStepByStepTourAccountStateValue()
  const setAccountState = useSetStepByStepTourAccountState()
  const anchorRef = useRef<HTMLDivElement>(null)
  const currentWorkspaceId = currentWorkspace.id
  const enabledForCurrentWorkspace = getEnabledForCurrentWorkspace(accountState, currentWorkspaceId)
  const visible = IS_CLOUD_EDITION && enabledForCurrentWorkspace && !shouldHideOnPathname(pathname)
  const expanded = !accountState.minimized

  if (!visible)
    return null

  const completedTaskIds = accountState.completedTaskIds
  const currentTask = STEP_BY_STEP_TOUR_TASKS.find(task => !completedTaskIds.includes(task.id))
  const tasks = STEP_BY_STEP_TOUR_TASKS.map((task): StepByStepTourTaskView => {
    const completed = completedTaskIds.includes(task.id)

    return {
      ...taskCopy[task.id],
      id: task.id,
      iconClassName: task.iconClassName,
      status: completed
        ? 'completed'
        : task.id === currentTask?.id ? 'current' : 'pending',
      primaryActionLabel,
      learnMoreLabel,
      learnMoreHref: task.learnMoreDocPath ? docLink(task.learnMoreDocPath) : undefined,
    }
  })

  const updateAccountState = (nextState: StepByStepTourAccountState) => {
    setAccountState(nextState)
  }

  const floatingChecklist = (
    <FloatingChecklist
      title={title}
      duration={duration}
      minimized={accountState.minimized}
      progress={{
        completed: completedTaskIds.length,
        total: STEP_BY_STEP_TOUR_TASKS.length,
      }}
      tasks={tasks}
      skipLabel={skipLabel}
      minimizeLabel={minimizeLabel}
      restoreLabel={restoreLabel}
      onMinimize={() => updateAccountState({ ...accountState, minimized: true })}
      onRestore={() => updateAccountState({ ...accountState, minimized: false })}
      onSkip={() => updateAccountState({
        ...accountState,
        skipped: true,
        manuallyEnabledWorkspaceIds: removeWorkspaceId(accountState.manuallyEnabledWorkspaceIds, currentWorkspaceId),
      })}
      onStartTask={(taskId) => {
        const task = STEP_BY_STEP_TOUR_TASKS.find(item => item.id === taskId)

        if (!task)
          return

        updateAccountState({
          ...accountState,
          completedTaskIds: addCompletedTask(accountState.completedTaskIds, taskId),
        })
        router.push(task.route)
      }}
    />
  )

  return (
    <div className={className}>
      <Popover open={expanded}>
        <div ref={anchorRef} aria-hidden="true" className="h-0 w-0" />
        {accountState.minimized && floatingChecklist}
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
