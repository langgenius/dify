'use client'
import type { FC } from 'react'
import type { QuadrantConfig, Task } from './types'
import { cn } from '@/utils/classnames'
import TaskItem from './task-item'

type QuadrantCardProps = {
  config: QuadrantConfig
  tasks: Task[]
  maxDisplay?: number
}

const QuadrantCard: FC<QuadrantCardProps> = ({
  config,
  tasks,
  maxDisplay = 3,
}) => {
  const { title, subtitle, bgClass, borderClass, titleClass } = config
  const displayTasks = tasks.slice(0, maxDisplay)
  const remainingCount = Math.max(0, tasks.length - maxDisplay)

  return (
    <div
      className={cn(
        'flex min-h-[200px] min-w-0 flex-col rounded-xl border p-3',
        bgClass,
        borderClass,
      )}
    >
      {/* Header */}
      <div className="mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className={cn('system-sm-semibold', titleClass)}>{title}</span>
          {tasks.length > 0 && (
            <span className="bg-components-badge-bg-gray rounded-full px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
              {tasks.length}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-tertiary">{subtitle}</div>
      </div>

      {/* Task List - scrollable area */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {displayTasks.length > 0
          ? (
              displayTasks.map((task, index) => (
                <TaskItem key={`${task.name}-${index}`} task={task} />
              ))
            )
          : (
              <div className="flex flex-1 items-center justify-center text-xs text-text-quaternary">
                No tasks
              </div>
            )}
      </div>

      {/* More indicator */}
      {remainingCount > 0 && (
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
