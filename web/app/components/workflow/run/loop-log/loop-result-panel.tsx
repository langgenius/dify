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
import type { LoopDurationMap, LoopVariableMap, NodeTracing } from '@/types/workflow'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
const i18nPrefix = 'workflow.singleRun'

type Props = {
  list: NodeTracing[][]
  onBack: () => void
  loopDurationMap?: LoopDurationMap
  loopVariableMap?: LoopVariableMap
}

const LoopResultPanel: FC<Props> = ({
  list,
  onBack,
  loopDurationMap,
  loopVariableMap,
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
      return <RiErrorWarningLine className='h-4 w-4 text-text-destructive' />

    if (isRunning)
      return <RiLoader2Line className='h-3.5 w-3.5 animate-spin text-primary-600' />

    return (
      <>
        {hasDurationMap && (
          <div className='system-xs-regular text-text-tertiary'>
            {countLoopDuration(loop, loopDurationMap)}
          </div>
        )}
        <RiArrowRightSLine
          className={cn(
            'h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200',
            expandedLoops[index] && 'rotate-90',
          )}
        />
      </>
    )
  }

  return (
    <div className='bg-components-panel-bg'>
      <div
        className='flex h-8 cursor-pointer items-center border-b-[0.5px] border-b-divider-regular px-4 text-text-accent-secondary'
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onBack()
        }}
      >
        <RiArrowLeftLine className='mr-1 h-4 w-4' />
        <div className='system-sm-medium'>{t(`${i18nPrefix}.back`)}</div>
      </div>
      {/* List */}
      <div className='bg-components-panel-bg p-2'>
        {list.map((loop, index) => (
          <div key={index} className={cn('mb-1 overflow-hidden rounded-xl border-none bg-background-section-burn')}>
            <div
              className={cn(
                'flex w-full cursor-pointer items-center justify-between px-3',
                expandedLoops[index] ? 'pb-2 pt-3' : 'py-3',
                'rounded-xl text-left',
              )}
              onClick={() => toggleLoop(index)}
            >
              <div className={cn('flex grow items-center gap-2')}>
                <div className='flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-divider-subtle bg-util-colors-cyan-cyan-500'>
                  <Loop className='h-3 w-3 text-text-primary-on-surface' />
                </div>
                <span className='system-sm-semibold-uppercase grow text-text-primary'>
                  {t(`${i18nPrefix}.loop`)} {index + 1}
                </span>
                {loopStatusShow(index, loop, loopDurationMap)}
              </div>
            </div>
            {expandedLoops[index] && <div
              className="h-px grow bg-divider-subtle"
            ></div>}
            <div className={cn(
              'transition-all duration-200',
              expandedLoops[index]
                ? 'opacity-100'
                : 'max-h-0 overflow-hidden opacity-0',
            )}>
              {
                loopVariableMap?.[index] && (
                  <div className='p-2 pb-0'>
                    <CodeEditor
                      readOnly
                      title={<div>{t('workflow.nodes.loop.loopVariables').toLocaleUpperCase()}</div>}
                      language={CodeLanguage.json}
                      height={112}
                      value={loopVariableMap[index]}
                      isJSONStringifyBeauty
                    />
                  </div>
                )
              }
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
