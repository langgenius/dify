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
  maxDisplay = 5,
}) => {
  const { title, subtitle, bgClass, borderClass, titleClass } = config
  const displayTasks = tasks.slice(0, maxDisplay)
  const remainingCount = Math.max(0, tasks.length - maxDisplay)

  return (
    <div
      className={cn(
        'flex min-h-[180px] flex-col rounded-xl border p-3',
        bgClass,
        borderClass,
      )}
    >
      {/* Header */}
      <div className="mb-2">
        <div className={cn('system-sm-semibold', titleClass)}>{title}</div>
        <div className="text-xs text-text-tertiary">{subtitle}</div>
      </div>

      {/* Task List */}
      <div className="flex flex-1 flex-col gap-2">
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
        <div className="mt-2 text-center text-xs text-text-tertiary">
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
