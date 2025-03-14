'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiErrorWarningLine,
  RiLoader2Line,
} from '@remixicon/react'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
import { Loop } from '@/app/components/base/icons/src/vender/workflow'
import cn from '@/utils/classnames'
import type { LoopDurationMap, NodeTracing } from '@/types/workflow'
const i18nPrefix = 'workflow.singleRun'

type Props = {
  list: NodeTracing[][]
  onBack: () => void
  loopDurationMap?: LoopDurationMap
}

const LoopResultPanel: FC<Props> = ({
  list,
  onBack,
  loopDurationMap,
}) => {
  const { t } = useTranslation()
  const [expandedLoops, setExpandedLoops] = useState<Record<number, boolean>>({})

  const toggleLoop = useCallback((index: number) => {
    setExpandedLoops(prev => ({
      ...prev,
      [index]: !prev[index],
    }))
  }, [])

  const countLoopDuration = (loop: NodeTracing[], loopDurationMap: LoopDurationMap): string => {
    const loopRunIndex = loop[0]?.execution_metadata?.loop_index as number
    const loopRunId = loop[0]?.execution_metadata?.parallel_mode_run_id
    const loopItem = loopDurationMap[loopRunId || loopRunIndex]
    const duration = loopItem
    return `${(duration && duration > 0.01) ? duration.toFixed(2) : 0.01}s`
  }

  const loopStatusShow = (index: number, loop: NodeTracing[], loopDurationMap?: LoopDurationMap) => {
    const hasFailed = loop.some(item => item.status === NodeRunningStatus.Failed)
    const isRunning = loop.some(item => item.status === NodeRunningStatus.Running)
    const hasDurationMap = loopDurationMap && Object.keys(loopDurationMap).length !== 0

    if (hasFailed)
      return <RiErrorWarningLine className='w-4 h-4 text-text-destructive' />

    if (isRunning)
      return <RiLoader2Line className='w-3.5 h-3.5 text-primary-600 animate-spin' />

    return (
      <>
        {hasDurationMap && (
          <div className='system-xs-regular text-text-tertiary'>
            {countLoopDuration(loop, loopDurationMap)}
          </div>
        )}
        <RiArrowRightSLine
          className={cn(
            'w-4 h-4 text-text-tertiary transition-transform duration-200 flex-shrink-0',
            expandedLoops[index] && 'transform rotate-90',
          )}
        />
      </>
    )
  }

  return (
    <div className='bg-components-panel-bg'>
      <div
        className='flex items-center px-4 h-8 text-text-accent-secondary cursor-pointer border-b-[0.5px] border-b-divider-regular'
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onBack()
        }}
      >
        <RiArrowLeftLine className='mr-1 w-4 h-4' />
        <div className='system-sm-medium'>{t(`${i18nPrefix}.back`)}</div>
      </div>
      {/* List */}
      <div className='p-2 bg-components-panel-bg'>
        {list.map((loop, index) => (
          <div key={index} className={cn('mb-1 overflow-hidden rounded-xl bg-background-section-burn border-none')}>
            <div
              className={cn(
                'flex items-center justify-between w-full px-3 cursor-pointer',
                expandedLoops[index] ? 'pt-3 pb-2' : 'py-3',
                'rounded-xl text-left',
              )}
              onClick={() => toggleLoop(index)}
            >
              <div className={cn('flex items-center gap-2 flex-grow')}>
                <div className='flex items-center justify-center w-4 h-4 rounded-[5px] border-divider-subtle bg-util-colors-cyan-cyan-500 shrink-0'>
                  <Loop className='w-3 h-3 text-text-primary-on-surface' />
                </div>
                <span className='system-sm-semibold-uppercase text-text-primary grow'>
                  {t(`${i18nPrefix}.loop`)} {index + 1}
                </span>
                {loopStatusShow(index, loop, loopDurationMap)}
              </div>
            </div>
            {expandedLoops[index] && <div
              className="grow h-px bg-divider-subtle"
            ></div>}
            <div className={cn(
              'overflow-hidden transition-all duration-200',
              expandedLoops[index] ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0',
            )}>
              <TracingPanel
                list={loop}
                className='bg-background-section-burn'
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
export default React.memo(LoopResultPanel)
