/**
 * Type definitions for Eisenhower Matrix (Task Quadrant) visualization
 */

export type Task = {
  name: string
  description?: string
  deadline?: string // YYYY-MM-DD format
  importance_score: number // 0-100, based on goal alignment and long-term value
  urgency_score: number // 0-100, based on deadline pressure and delay penalty
  action_advice?: string // Suggested action for this task
}

export type QuadrantData = {
  q1: Task[] // Urgent & Important - Do First
  q2: Task[] // Not Urgent & Important - Schedule
  q3: Task[] // Urgent & Not Important - Delegate
  q4: Task[] // Not Urgent & Not Important - Eliminate
}

export type QuadrantConfig = {
  key: 'q1' | 'q2' | 'q3' | 'q4'
  title: string
  subtitle: string
  bgClass: string
  borderClass: string
  titleClass: string
}

export const QUADRANT_CONFIGS: Record<string, QuadrantConfig> = {
  q1: {
    key: 'q1',
    title: 'Do First',
    subtitle: 'Urgent & Important',
    bgClass: 'bg-state-destructive-hover',
    borderClass: 'border-state-destructive-border',
    titleClass: 'text-text-destructive',
  },
  q2: {
    key: 'q2',
    title: 'Schedule',
    subtitle: 'Important & Not Urgent',
    bgClass: 'bg-state-accent-hover',
    borderClass: 'border-state-accent-border',
    titleClass: 'text-text-accent',
  },
  q3: {
    key: 'q3',
    title: 'Delegate',
    subtitle: 'Urgent & Not Important',
    bgClass: 'bg-state-warning-hover',
    borderClass: 'border-state-warning-border',
    titleClass: 'text-text-warning',
  },
  q4: {
    key: 'q4',
    title: 'Eliminate',
    subtitle: 'Not Urgent & Not Important',
    bgClass: 'bg-components-panel-on-panel-item-bg',
    borderClass: 'border-divider-regular',
    titleClass: 'text-text-tertiary',
  },
}

/**
 * Validates if the data structure matches QuadrantData interface
 */
export function isValidQuadrantData(data: unknown): data is QuadrantData {
  if (typeof data !== 'object' || data === null)
    return false

  const d = data as Record<string, unknown>
  return (
    Array.isArray(d.q1)
    && Array.isArray(d.q2)
    && Array.isArray(d.q3)
    && Array.isArray(d.q4)
  )
}
