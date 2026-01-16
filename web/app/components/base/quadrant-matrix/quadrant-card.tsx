'use client'
import type { FC } from 'react'
import type { QuadrantConfig, Task } from './types'
import { cn } from '@/utils/classnames'
import TaskItem from './task-item'

type QuadrantCardProps = {
  config: QuadrantConfig
  tasks: Task[]
  expanded?: boolean
  maxDisplay?: number
}

const QuadrantCard: FC<QuadrantCardProps> = ({
  config,
  tasks,
  expanded = false,
  maxDisplay = 3,
}) => {
  const { number, title, subtitle, bgClass, borderClass, titleClass } = config
  const displayLimit = expanded ? Infinity : maxDisplay
  const displayTasks = tasks.slice(0, displayLimit)
  const remainingCount = Math.max(0, tasks.length - displayLimit)

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-xl border p-3',
        bgClass,
        borderClass,
        expanded ? 'min-h-[280px]' : 'min-h-[200px]',
      )}
    >
      {/* Header with numbered circle */}
      <div className="mb-2 shrink-0">
        <div className="flex items-center gap-2">
          {/* Numbered circle */}
          <span className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold',
            borderClass,
            titleClass,
          )}
          >
            {number}
          </span>
          <span className={cn('system-sm-semibold', titleClass)}>{title}</span>
          {tasks.length > 0 && (
            <span className="bg-components-badge-bg-gray rounded-full px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
              {tasks.length}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-tertiary">{subtitle}</div>
      </div>

      {/* Task List */}
      <div className={cn(
        'flex min-h-0 flex-1 flex-col gap-2',
        expanded && 'overflow-y-auto',
      )}
      >
        {displayTasks.length > 0
          ? (
              displayTasks.map((task, index) => (
                <TaskItem
                  key={`${task.name}-${index}`}
                  task={task}
                  expanded={expanded}
                />
              ))
            )
          : (
              <div className="flex flex-1 items-center justify-center text-xs text-text-quaternary">
                No tasks
              </div>
            )}
      </div>

      {/* More indicator (only in non-expanded mode) */}
      {!expanded && remainingCount > 0 && (
        <div className="mt-2 shrink-0 text-center text-[11px] text-text-tertiary">
          +
          {remainingCount}
          {' '}
          more
        </div>
      )}
    </div>
  )
}

export default QuadrantCard
