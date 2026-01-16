'use client'
import type { FC } from 'react'
import type { Task } from './types'
import { cn } from '@/utils/classnames'

type ScoreBadgeProps = {
  label: string
  score: number
  colorClass: string
}

const ScoreBadge: FC<ScoreBadgeProps> = ({ label, score, colorClass }) => {
  return (
    <span className={cn('text-xs font-medium', colorClass)}>
      {label}
      :
      {score}
    </span>
  )
}

type TaskItemProps = {
  task: Task
  showScores?: boolean
}

const TaskItem: FC<TaskItemProps> = ({ task, showScores = true }) => {
  const { name, description, deadline, importance_score, urgency_score, action_advice } = task

  return (
    <div className="group rounded-lg bg-components-panel-bg p-2.5 shadow-xs transition-all hover:shadow-sm">
      {/* Task Name */}
      <div className="system-sm-medium text-text-primary">{name}</div>

      {/* Description (if exists) */}
      {description && (
        <div className="mt-1 line-clamp-2 text-xs text-text-tertiary">
          {description}
        </div>
      )}

      {/* Metadata Row */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Deadline Badge */}
        {deadline && (
          <span className="bg-components-badge-bg-gray inline-flex items-center rounded px-1.5 py-0.5 text-xs text-text-tertiary">
            {deadline}
          </span>
        )}

        {/* Scores (optional) */}
        {showScores && (
          <div className="flex items-center gap-1.5">
            <ScoreBadge
              label="I"
              score={importance_score}
              colorClass="text-text-accent"
            />
            <ScoreBadge
              label="U"
              score={urgency_score}
              colorClass="text-text-warning"
            />
          </div>
        )}
      </div>

      {/* Action Advice (if exists) */}
      {action_advice && (
        <div className="mt-2 border-t border-divider-subtle pt-2 text-xs italic text-text-quaternary">
          {action_advice}
        </div>
      )}
    </div>
  )
}

export default TaskItem
