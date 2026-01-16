'use client'
import type { FC } from 'react'
import type { QuadrantData } from './types'
import { useMemo } from 'react'
import { cn } from '@/utils/classnames'
import QuadrantCard from './quadrant-card'
import { isValidQuadrantData, QUADRANT_CONFIGS } from './types'

type QuadrantMatrixProps = {
  content: string
}

const QuadrantMatrix: FC<QuadrantMatrixProps> = ({ content }) => {
  const parsedData = useMemo<QuadrantData | null>(() => {
    try {
      const trimmed = content.trim()
      const data = JSON.parse(trimmed)

      if (!isValidQuadrantData(data))
        return null

      return data
    }
    catch {
      return null
    }
  }, [content])

  if (!parsedData) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-components-panel-bg-blur p-8">
        <div className="text-center text-text-secondary">
          <div className="mb-2 text-lg">Invalid Quadrant Data</div>
          <div className="text-sm text-text-tertiary">
            Expected JSON format with q1, q2, q3, q4 arrays
          </div>
        </div>
      </div>
    )
  }

  const totalTasks
    = parsedData.q1.length
      + parsedData.q2.length
      + parsedData.q3.length
      + parsedData.q4.length

  return (
    <div className="w-full rounded-lg bg-components-panel-bg-blur p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="system-md-semibold text-text-primary">
            Eisenhower Matrix
          </div>
          <div className="text-xs text-text-tertiary">
            {totalTasks}
            {' '}
            task
            {totalTasks !== 1 ? 's' : ''}
            {' '}
            across 4 quadrants
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-text-quaternary">
          <span className="text-text-accent">I</span>
          =Importance
          <span className="ml-2 text-text-warning">U</span>
          =Urgency
        </div>
      </div>

      {/* Axis Labels */}
      <div className="relative">
        {/* Importance Label (Top Center) */}
        <div className="mb-2 flex items-center justify-center">
          <span className="rounded bg-state-accent-hover px-2 py-0.5 text-xs font-medium text-text-accent">
            Important
          </span>
        </div>

        {/* Main Grid with Urgency Labels */}
        <div className="flex gap-2">
          {/* Left: Not Urgent Label */}
          <div className="flex w-6 shrink-0 items-center justify-center">
            <span
              className={cn(
                '-rotate-90 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium',
                'bg-components-panel-on-panel-item-bg text-text-tertiary',
              )}
            >
              Not Urgent
            </span>
          </div>

          {/* Center: 2x2 Grid */}
          <div className="flex-1">
            <div className="grid grid-cols-2 gap-3">
              {/* Row 1: Important */}
              <QuadrantCard
                config={QUADRANT_CONFIGS.q2}
                tasks={parsedData.q2}
              />
              <QuadrantCard
                config={QUADRANT_CONFIGS.q1}
                tasks={parsedData.q1}
              />

              {/* Row 2: Not Important */}
              <QuadrantCard
                config={QUADRANT_CONFIGS.q4}
                tasks={parsedData.q4}
              />
              <QuadrantCard
                config={QUADRANT_CONFIGS.q3}
                tasks={parsedData.q3}
              />
            </div>
          </div>

          {/* Right: Urgent Label */}
          <div className="flex w-6 shrink-0 items-center justify-center">
            <span className="-rotate-90 whitespace-nowrap rounded bg-state-warning-hover px-2 py-0.5 text-xs font-medium text-text-warning">
              Urgent
            </span>
          </div>
        </div>

        {/* Not Important Label (Bottom Center) */}
        <div className="mt-2 flex items-center justify-center">
          <span className="rounded bg-components-panel-on-panel-item-bg px-2 py-0.5 text-xs font-medium text-text-tertiary">
            Not Important
          </span>
        </div>
      </div>
    </div>
  )
}

export default QuadrantMatrix
