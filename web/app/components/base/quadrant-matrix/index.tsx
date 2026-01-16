'use client'
import type { FC } from 'react'
import type { QuadrantData } from './types'
import { useMemo } from 'react'
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
      <div className="flex items-center justify-center rounded-xl bg-components-panel-bg-blur p-8">
        <div className="text-center text-text-secondary">
          <div className="system-md-semibold mb-2">Invalid Quadrant Data</div>
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
    <div className="w-full overflow-hidden rounded-xl bg-components-panel-bg-blur p-4">
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
            prioritized
          </div>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-text-quaternary">
          <span>
            <span className="font-medium text-text-accent">I</span>
            {' '}
            = Importance
          </span>
          <span>
            <span className="font-medium text-text-warning">U</span>
            {' '}
            = Urgency
          </span>
        </div>
      </div>

      {/* Axis Labels - Horizontal */}
      <div className="mb-2 grid grid-cols-2 gap-3 pl-9">
        <div className="text-center text-[11px] text-text-tertiary">
          <span className="rounded bg-components-panel-on-panel-item-bg px-2 py-0.5">
            Not Urgent
          </span>
        </div>
        <div className="text-center text-[11px] text-text-warning">
          <span className="rounded bg-state-warning-hover px-2 py-0.5">
            Urgent
          </span>
        </div>
      </div>

      {/* Main Grid with Row Labels */}
      <div className="flex gap-3">
        {/* Row Labels - Vertical (rotated 90 degrees) */}
        <div className="flex w-6 shrink-0 flex-col gap-3">
          <div className="flex min-h-[200px] items-center justify-center">
            <span className="-rotate-90 whitespace-nowrap rounded bg-state-accent-hover px-2 py-0.5 text-[11px] text-text-accent">
              Important
            </span>
          </div>
          <div className="flex min-h-[200px] items-center justify-center">
            <span className="-rotate-90 whitespace-nowrap rounded bg-components-panel-on-panel-item-bg px-2 py-0.5 text-[11px] text-text-tertiary">
              Not Important
            </span>
          </div>
        </div>

        {/* 2x2 Grid */}
        <div className="min-w-0 flex-1">
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
      </div>
    </div>
  )
}

export default QuadrantMatrix
