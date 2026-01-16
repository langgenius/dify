'use client'
import type { FC } from 'react'
import type { Task } from './types'
import { RiCalendarLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type TaskItemProps = {
  task: Task
  expanded?: boolean
  showScores?: boolean
}

const TaskItem: FC<TaskItemProps> = ({ task, expanded = false, showScores = true }) => {
  const { t } = useTranslation()
  const { name, description, deadline, importance_score, urgency_score, action_advice } = task

  return (
    <div className="group min-w-0 rounded-lg bg-components-panel-bg p-2.5 shadow-xs transition-all hover:shadow-sm">
      {/* Header: Task Name + Scores */}
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            'system-sm-medium min-w-0 flex-1 text-text-primary',
            !expanded && 'truncate',
          )}
          title={name}
        >
          {name}
        </div>
        {showScores && (
          <div className="flex shrink-0 items-center gap-1 text-[10px] font-medium">
            <span className="text-text-accent">
              I:
              {importance_score}
            </span>
            <span className="text-text-warning">
              U:
              {urgency_score}
            </span>
          </div>
        )}
      </div>

      {/* Description */}
      {description && (
        <div className={cn(
          'mt-1 text-xs text-text-tertiary',
          !expanded && 'line-clamp-2',
        )}
        >
          {description}
        </div>
      )}

      {/* Deadline Badge */}
      {deadline && (
        <div className="mt-1.5">
          <span className="bg-components-badge-bg-gray inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-tertiary">
            <RiCalendarLine className="h-3 w-3" />
            <span>
              {t('quadrantMatrix.deadline', { ns: 'app' })}
              {' '}
              {deadline}
            </span>
          </span>
        </div>
      )}

      {/* Action Advice */}
      {action_advice && (
        <div className="mt-2 border-t border-divider-subtle pt-2">
          <p
            className={cn(
              'text-xs italic text-text-quaternary',
              !expanded && 'line-clamp-2',
            )}
            title={!expanded ? action_advice : undefined}
          >
            {action_advice}
          </p>
        </div>
      )}
    </div>
  )
}

export default TaskItem
