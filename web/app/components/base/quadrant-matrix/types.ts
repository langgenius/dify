/**
 * Type definitions for Eisenhower Matrix (Task Quadrant) visualization
 */
import type { I18nKeysWithPrefix } from '@/types/i18n'

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
  q4: Task[] // Not Urgent & Not Important - Don't Do
}

type QuadrantKeyBase = I18nKeysWithPrefix<'app', 'quadrantMatrix.q'>
type QuadrantTitleKey = Extract<QuadrantKeyBase, `${string}.title`>
type QuadrantSubtitleKey = Extract<QuadrantKeyBase, `${string}.subtitle`>

export type QuadrantConfig = {
  key: 'q1' | 'q2' | 'q3' | 'q4'
  number: number
  titleKey: QuadrantTitleKey // i18n key for title
  subtitleKey: QuadrantSubtitleKey // i18n key for subtitle
  bgClass: string
  borderClass: string
  titleClass: string
}

// Layout based on Eisenhower Matrix:
// Q1 (Do First) - top-left, Q2 (Schedule) - top-right
// Q3 (Delegate) - bottom-left, Q4 (Don't Do) - bottom-right
export const QUADRANT_CONFIGS: Record<string, QuadrantConfig> = {
  q1: {
    key: 'q1',
    number: 1,
    titleKey: 'quadrantMatrix.q1.title',
    subtitleKey: 'quadrantMatrix.q1.subtitle',
    bgClass: 'bg-state-destructive-hover',
    borderClass: 'border-state-destructive-border',
    titleClass: 'text-text-destructive',
  },
  q2: {
    key: 'q2',
    number: 2,
    titleKey: 'quadrantMatrix.q2.title',
    subtitleKey: 'quadrantMatrix.q2.subtitle',
    bgClass: 'bg-state-accent-hover',
    borderClass: 'border-state-accent-border',
    titleClass: 'text-text-accent',
  },
  q3: {
    key: 'q3',
    number: 3,
    titleKey: 'quadrantMatrix.q3.title',
    subtitleKey: 'quadrantMatrix.q3.subtitle',
    bgClass: 'bg-state-warning-hover',
    borderClass: 'border-state-warning-border',
    titleClass: 'text-text-warning',
  },
  q4: {
    key: 'q4',
    number: 4,
    titleKey: 'quadrantMatrix.q4.title',
    subtitleKey: 'quadrantMatrix.q4.subtitle',
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
