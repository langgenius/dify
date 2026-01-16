'use client'
import type { FC } from 'react'
import type { QuadrantData } from './types'
import { RiExpandDiagonalLine } from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import ActionButton from '@/app/components/base/action-button'
import FullScreenModal from '@/app/components/base/fullscreen-modal'
import QuadrantCard from './quadrant-card'
import { isValidQuadrantData, QUADRANT_CONFIGS } from './types'

type QuadrantMatrixProps = {
  content: string
}

const QuadrantMatrix: FC<QuadrantMatrixProps> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false)

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

  const handleExpand = useCallback(() => {
    setIsExpanded(true)
  }, [])

  const handleClose = useCallback(() => {
    setIsExpanded(false)
  }, [])

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

  // Shared grid content component
  const renderGrid = (expanded: boolean) => (
    <div className="grid grid-cols-2 gap-3">
      {/* Row 1: Q1 (Do First), Q2 (Schedule) */}
      <QuadrantCard
        config={QUADRANT_CONFIGS.q1}
        tasks={parsedData.q1}
        expanded={expanded}
      />
      <QuadrantCard
        config={QUADRANT_CONFIGS.q2}
        tasks={parsedData.q2}
        expanded={expanded}
      />

      {/* Row 2: Q3 (Delegate), Q4 (Don't Do) */}
      <QuadrantCard
        config={QUADRANT_CONFIGS.q3}
        tasks={parsedData.q3}
        expanded={expanded}
      />
      <QuadrantCard
        config={QUADRANT_CONFIGS.q4}
        tasks={parsedData.q4}
        expanded={expanded}
      />
    </div>
  )

  return (
    <>
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
          {/* Legend + Expand Button */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-[11px] text-text-quaternary">
              <span>
                <span className="font-medium text-blue-600">I</span>
                {' '}
                = Importance
              </span>
              <span>
                <span className="font-medium text-orange-500">U</span>
                {' '}
                = Urgency
              </span>
            </div>
            <ActionButton onClick={handleExpand}>
              <RiExpandDiagonalLine className="h-4 w-4" />
            </ActionButton>
          </div>
        </div>

        {/* 2x2 Grid */}
        {renderGrid(false)}
      </div>

      {/* Fullscreen Modal */}
      <FullScreenModal
        open={isExpanded}
        onClose={handleClose}
        closable
      >
        <div className="flex h-full flex-col p-6">
          {/* Modal Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <div className="text-xl font-semibold text-text-primary">
                Eisenhower Matrix
              </div>
              <div className="text-sm text-text-tertiary">
                {totalTasks}
                {' '}
                task
                {totalTasks !== 1 ? 's' : ''}
                {' '}
                prioritized
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm text-text-quaternary">
              <span>
                <span className="font-medium text-blue-600">I</span>
                {' '}
                = Importance
              </span>
              <span>
                <span className="font-medium text-orange-500">U</span>
                {' '}
                = Urgency
              </span>
            </div>
          </div>

          {/* Expanded Grid */}
          <div className="min-h-0 flex-1">
            {renderGrid(true)}
          </div>
        </div>
      </FullScreenModal>
    </>
  )
}

export default QuadrantMatrix
