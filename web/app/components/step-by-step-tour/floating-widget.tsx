'use client'

import type { ComponentProps, RefObject } from 'react'
import type { StepByStepTourTaskId, StepByStepTourTaskView } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverDescription, PopoverTitle } from '@langgenius/dify-ui/popover'
import { useEffect } from 'react'

export type FloatingChecklistProps = {
  className?: string
  title: string
  duration: string
  progress: {
    ariaValueText: string
    completed: number
    total: number
  }
  completionPrompt?: {
    description: string
    dismissLabel: string
    label: string
    onDismiss: () => void
    title: string
  }
  tasks: StepByStepTourTaskView[]
  closeButtonRef: RefObject<HTMLButtonElement | null>
  skipLabel: string
  minimizeLabel: string
  getTaskCompleteLabel: (taskTitle: string) => string
  getTaskIncompleteLabel: (taskTitle: string) => string
  onMinimize: () => void
  onSkip: () => void
  onStartTask: (taskId: StepByStepTourTaskId) => void
  onUncompleteTask: (taskId: StepByStepTourTaskId) => void
}

export function FloatingChecklist({
  className,
  title,
  duration,
  progress,
  completionPrompt,
  tasks,
  closeButtonRef,
  skipLabel,
  minimizeLabel,
  getTaskCompleteLabel,
  getTaskIncompleteLabel,
  onMinimize,
  onSkip,
  onStartTask,
  onUncompleteTask,
}: FloatingChecklistProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex max-h-[calc(100vh-16px)] w-[320px] max-w-[calc(100vw-16px)] flex-col overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur bg-clip-padding shadow-[0_8px_8px_-4px_var(--color-shadow-shadow-1),0_20px_24px_-4px_var(--color-shadow-shadow-5)] backdrop-blur-[10px]',
        className,
      )}
    >
      <div className="flex w-full shrink-0 flex-col gap-2 px-4 pt-4 pb-1">
        <div className="flex w-full items-start gap-1">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <PopoverTitle className="system-xl-semibold text-text-secondary">{title}</PopoverTitle>
            <PopoverDescription className="system-xs-regular text-text-tertiary">
              {duration}
            </PopoverDescription>
          </div>
          {!completionPrompt && (
            <>
              <Button
                variant="ghost"
                size="small"
                className="h-6 px-1.5 text-text-tertiary"
                onClick={onSkip}
              >
                {skipLabel}
              </Button>
              <IconButton
                ref={closeButtonRef}
                size="md"
                aria-label={minimizeLabel}
                onClick={onMinimize}
              >
                <span aria-hidden className="i-ri-arrow-left-down-line size-4" />
              </IconButton>
            </>
          )}
        </div>
        <TourProgress
          ariaValueText={progress.ariaValueText}
          completed={progress.completed}
          total={progress.total}
        />
      </div>
      <div className="flex w-full shrink-0 flex-col gap-1 p-2">
        {tasks.map((task) => (
          <TourTaskRow
            key={task.id}
            task={task}
            getTaskCompleteLabel={getTaskCompleteLabel}
            getTaskIncompleteLabel={getTaskIncompleteLabel}
            onStartTask={onStartTask}
            onUncompleteTask={onUncompleteTask}
          />
        ))}
        {completionPrompt && (
          <TourCompletionPrompt {...completionPrompt} closeButtonRef={closeButtonRef} />
        )}
      </div>
    </section>
  )
}

function TourCompletionPrompt({
  description,
  dismissLabel,
  label,
  onDismiss,
  title,
  closeButtonRef,
}: NonNullable<FloatingChecklistProps['completionPrompt']> & {
  closeButtonRef: RefObject<HTMLButtonElement | null>
}) {
  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true })
  }, [closeButtonRef])

  return (
    <section
      aria-label={label}
      aria-live="polite"
      className="mt-1 flex w-full flex-col items-center rounded-xl bg-background-section px-6 py-5 text-center"
    >
      <span
        aria-hidden
        className="mb-3 flex size-5 items-center justify-center rounded-full border-2 border-saas-dify-blue-inverted text-saas-dify-blue-inverted"
      >
        <span className="i-ri-check-line size-3.5" />
      </span>
      <h3 className="system-md-semibold text-text-primary">{title}</h3>
      <p className="mt-1 system-sm-regular text-text-tertiary">{description}</p>
      <Button
        ref={closeButtonRef}
        variant="secondary"
        size="medium"
        className="mt-4 min-w-20"
        onClick={onDismiss}
      >
        {dismissLabel}
      </Button>
    </section>
  )
}

export function MinimizedTourPill({
  title,
  progress,
  className,
  ...props
}: {
  title: string
  progress: FloatingChecklistProps['progress']
} & ComponentProps<'button'>) {
  return (
    <button
      {...props}
      type="button"
      className={cn(
        'inline-flex h-8 w-45.75 max-w-[calc(100vw-16px)] items-center gap-2 overflow-hidden rounded-full border-[0.5px] border-components-panel-border bg-background-section px-3 py-2 text-saas-dify-blue-inverted transition-[background-color,opacity] hover:bg-state-base-hover motion-reduce:transition-none',
        className,
      )}
    >
      <span aria-hidden className="i-custom-vender-line-education-lesson-open-01 size-4 shrink-0" />
      <span className="w-26 shrink-0 truncate system-sm-medium">{title}</span>
      <span className="flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary tabular-nums">
        {`${progress.completed}/${progress.total}`}
      </span>
    </button>
  )
}

function TourProgress({
  ariaValueText,
  completed,
  total,
}: {
  ariaValueText: string
  completed: number
  total: number
}) {
  return (
    <>
      <div
        className="sr-only"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-valuetext={ariaValueText}
      />
      <div className="flex w-full items-center gap-1 py-0.5" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => {
          const active = index < completed

          return (
            <div
              key={index}
              className={cn(
                'h-1 min-w-0 flex-1 rounded-full',
                active ? 'bg-saas-dify-blue-inverted' : 'bg-components-slider-track',
              )}
            />
          )
        })}
      </div>
    </>
  )
}

function TourTaskRow({
  task,
  getTaskCompleteLabel,
  getTaskIncompleteLabel,
  onStartTask,
  onUncompleteTask,
}: {
  task: StepByStepTourTaskView
  getTaskCompleteLabel: (taskTitle: string) => string
  getTaskIncompleteLabel: (taskTitle: string) => string
  onStartTask: (taskId: StepByStepTourTaskId) => void
  onUncompleteTask: (taskId: StepByStepTourTaskId) => void
}) {
  const completed = task.status === 'completed'
  const current = task.status === 'current'
  const disabled = task.status === 'disabled'

  return (
    <div
      data-status={task.status}
      aria-current={current ? 'step' : undefined}
      aria-disabled={disabled || undefined}
      className="group flex w-full items-start gap-1 rounded-xl p-2 transition-colors data-[status=completed]:items-center data-[status=current]:bg-state-base-hover-subtle data-[status=disabled]:cursor-not-allowed data-[status=disabled]:opacity-60"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 group-data-[status=completed]:items-center">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-components-panel-border-subtle bg-components-panel-bg text-text-secondary group-data-[status=completed]:opacity-50 group-data-[status=current]:text-text-accent-light-mode-only">
          <span aria-hidden className={cn('size-4', task.iconClassName)} />
        </div>
        <div className="min-w-0 flex-1 group-data-[status=completed]:opacity-50">
          <div className="system-md-medium text-text-secondary group-data-[status=completed]:line-through">
            {task.title}
          </div>
          {!completed && (
            <>
              <p className="mt-0.5 system-xs-regular text-text-tertiary">
                {disabled && task.disabledReason ? task.disabledReason : task.description}
              </p>
              <div className="mt-2 flex items-center gap-1 pb-1">
                <Button
                  variant="secondary"
                  size="small"
                  className="min-w-20.75"
                  disabled={disabled}
                  onClick={() => onStartTask(task.id)}
                >
                  {task.primaryActionLabel}
                </Button>
                {task.learnMoreHref && task.learnMoreLabel && (
                  <a
                    href={task.learnMoreHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-6 min-w-24.5 items-center justify-center gap-1 rounded-md px-2 system-xs-medium text-text-tertiary outline-hidden hover:bg-components-button-ghost-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  >
                    {task.learnMoreLabel}
                    <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <TaskStatusIndicator
        completed={completed}
        completeLabel={getTaskCompleteLabel(task.title)}
        incompleteLabel={getTaskIncompleteLabel(task.title)}
        onUncomplete={() => onUncompleteTask(task.id)}
      />
    </div>
  )
}

function TaskStatusIndicator({
  completed,
  completeLabel,
  incompleteLabel,
  onUncomplete,
}: {
  completed: boolean
  completeLabel: string
  incompleteLabel: string
  onUncomplete: () => void
}) {
  return (
    <button
      type="button"
      aria-label={completed ? incompleteLabel : completeLabel}
      aria-disabled={!completed || undefined}
      data-completed={completed ? '' : undefined}
      className="flex size-4.5 shrink-0 items-center justify-center rounded-full border border-components-checkbox-border bg-components-checkbox-bg-unchecked outline-state-accent-solid focus-visible:outline-2 focus-visible:outline-offset-2 aria-disabled:cursor-not-allowed data-completed:border-transparent data-completed:bg-saas-dify-blue-accessible data-completed:text-text-primary-on-surface"
      onClick={completed ? onUncomplete : undefined}
    >
      {completed && <span aria-hidden className="i-ri-check-line size-3" />}
    </button>
  )
}
