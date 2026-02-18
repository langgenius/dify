'use client'
import type { FC } from 'react'
import type { IterationDurationMap, NodeTracing } from '@/types/workflow'
import {
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiErrorWarningLine,
  RiLoader2Line,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Iteration } from '@/app/components/base/icons/src/vender/workflow'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

const i18nPrefix = 'singleRun'

type Props = {
  list: NodeTracing[][]
  onBack: () => void
  iterDurationMap?: IterationDurationMap
}

const IterationResultPanel: FC<Props> = ({
  list,
  onBack,
  iterDurationMap,
}) => {
  const { t } = useTranslation()
  const [expandedIterations, setExpandedIterations] = useState<Record<number, boolean>>({})

  const toggleIteration = useCallback((index: number) => {
    setExpandedIterations(prev => ({
      ...prev,
      [index]: !prev[index],
    }))
  }, [])
  const countIterDuration = (iteration: NodeTracing[], iterDurationMap: IterationDurationMap): string => {
    const IterRunIndex = iteration[0]?.execution_metadata?.iteration_index as number
    const iterRunId = iteration[0]?.execution_metadata?.parallel_mode_run_id
    const iterItem = iterDurationMap[iterRunId || IterRunIndex]
    const duration = iterItem
    return `${(duration && duration > 0.01) ? duration.toFixed(2) : 0.01}s`
  }
  const iterationStatusShow = (index: number, iteration: NodeTracing[], iterDurationMap?: IterationDurationMap) => {
    const hasFailed = iteration.some(item => item.status === NodeRunningStatus.Failed)
    const isRunning = iteration.some(item => item.status === NodeRunningStatus.Running)
    const hasDurationMap = iterDurationMap && Object.keys(iterDurationMap).length !== 0

    if (hasFailed)
      return <RiErrorWarningLine className="h-4 w-4 text-text-destructive" />

    if (isRunning)
      return <RiLoader2Line className="h-3.5 w-3.5 animate-spin text-primary-600" />

    return (
      <>
        {hasDurationMap && (
          <div className="system-xs-regular text-text-tertiary">
            {countIterDuration(iteration, iterDurationMap)}
          </div>
        )}
        <RiArrowRightSLine
          className={cn(
            'h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200',
            expandedIterations[index] && 'rotate-90',
          )}
        />
      </>
    )
  }

  return (
    <div className="bg-components-panel-bg">
      <div
        className="flex h-8 cursor-pointer items-center border-b-[0.5px] border-b-divider-regular px-4 text-text-accent-secondary"
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onBack()
        }}
      >
        <RiArrowLeftLine className="mr-1 h-4 w-4" />
        <div className="system-sm-medium">{t(`${i18nPrefix}.back`, { ns: 'workflow' })}</div>
      </div>
      {/* List */}
      <div className="bg-components-panel-bg p-2">
        {list.map((iteration, index) => (
          <div key={index} className={cn('mb-1 overflow-hidden rounded-xl border-none bg-background-section-burn')}>
            <div
              className={cn(
                'flex w-full cursor-pointer items-center justify-between px-3',
                expandedIterations[index] ? 'pb-2 pt-3' : 'py-3',
                'rounded-xl text-left',
              )}
              onClick={() => toggleIteration(index)}
            >
              <div className={cn('flex grow items-center gap-2')}>
                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-divider-subtle bg-util-colors-cyan-cyan-500">
                  <Iteration className="h-3 w-3 text-text-primary-on-surface" />
                </div>
                <span className="system-sm-semibold-uppercase grow text-text-primary">
                  {t(`${i18nPrefix}.iteration`, { ns: 'workflow' })}
                  {' '}
                  {index + 1}
                </span>
                {iterationStatusShow(index, iteration, iterDurationMap)}
              </div>
            </div>
            {expandedIterations[index] && (
              <div
                className="h-px grow bg-divider-subtle"
              >
              </div>
            )}
            <div className={cn(
              'transition-all duration-200',
              expandedIterations[index]
                ? 'opacity-100'
                : 'max-h-0 overflow-hidden opacity-0',
            )}
            >
              <TracingPanel
                list={iteration}
                className="bg-background-section-burn"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
export default React.memo(IterationResultPanel)
