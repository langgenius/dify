'use client'
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  RiAlertFill,
  RiArrowRightSLine,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Line,
} from '@remixicon/react'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import Split from '../nodes/_base/components/split'
import cn from '@/utils/classnames'
import StatusContainer from '@/app/components/workflow/run/status-container'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import type { NodeTracing } from '@/types/workflow'

type Props = {
  className?: string
  nodeInfo: NodeTracing
  inMessage?: boolean
  hideProcessDetail?: boolean
  onShowIterationDetail?: (detail: NodeTracing[][]) => void
  notShowIterationNav?: boolean
  justShowIterationNavArrow?: boolean
}

const NodePanel: FC<Props> = ({
  className,
  nodeInfo,
  inMessage = false,
  hideProcessDetail,
  onShowIterationDetail,
  notShowIterationNav,
  justShowIterationNavArrow,
}) => {
  const [collapseState, doSetCollapseState] = useState<boolean>(true)
  const setCollapseState = useCallback((state: boolean) => {
    if (hideProcessDetail)
      return
    doSetCollapseState(state)
  }, [hideProcessDetail])
  const { t } = useTranslation()

  const getTime = (time: number) => {
    if (time < 1)
      return `${(time * 1000).toFixed(3)} ms`
    if (time > 60)
      return `${parseInt(Math.round(time / 60).toString())} m ${(time % 60).toFixed(3)} s`
    return `${time.toFixed(3)} s`
  }

  const getTokenCount = (tokens: number) => {
    if (tokens < 1000)
      return tokens
    if (tokens >= 1000 && tokens < 1000000)
      return `${parseFloat((tokens / 1000).toFixed(3))}K`
    if (tokens >= 1000000)
      return `${parseFloat((tokens / 1000000).toFixed(3))}M`
  }

  useEffect(() => {
    setCollapseState(!nodeInfo.expand)
  }, [nodeInfo.expand, setCollapseState])

  const isIterationNode = nodeInfo.node_type === BlockEnum.Iteration
  const handleOnShowIterationDetail = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    onShowIterationDetail?.(nodeInfo.details || [])
  }
  return (
    <div className={cn('px-2', inMessage && '!p-0', className)}>
      <div className={cn(
        'group transition-all bg-components-panel-on-panel-item-bg border-[0.5px] border-components-panel-border radius-lg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
        !collapseState && 'hover:bg-components-panel-on-panel-item-bg',
      )}>
        <div
          className={cn(
            'flex items-center py-2 pl-[6px] pr-3 cursor-pointer',
            inMessage && 'py-1.5 pl-[4px] pr-2',
            !collapseState && 'pb-1',
          )}
          onClick={() => setCollapseState(!collapseState)}
        >
          {!hideProcessDetail && (
            <RiArrowRightSLine
              className={cn(
                'shrink-0 w-4 h-4 text-text-quaternary transition-all group-hover:text-text-tertiary',
                !collapseState && 'rotate-90',
              )}
            />
          )}
          <BlockIcon size={inMessage ? 'xs' : 'sm'} className={cn('shrink-0 mr-2', inMessage && '!mr-1')} type={nodeInfo.node_type} toolIcon={nodeInfo.extras?.icon || nodeInfo.extras} />
          <div className={cn(
            'grow text-text-secondary system-sm-semibold-uppercase truncate',
            inMessage && '!system-xs-semibold-uppercase',
          )} title={nodeInfo.title}>{nodeInfo.title}</div>
          {nodeInfo.status !== 'running' && !inMessage && (
            <div className='shrink-0 text-text-tertiary system-xs-regular'>{`${getTime(nodeInfo.elapsed_time || 0)} · ${getTokenCount(nodeInfo.execution_metadata?.total_tokens || 0)} tokens`}</div>
          )}
          {nodeInfo.status === 'succeeded' && (
            <RiCheckboxCircleFill className={cn('shrink-0 ml-2 w-4 h-4 text-text-success', inMessage && 'w-3.5 h-3.5')} />
          )}
          {nodeInfo.status === 'failed' && (
            <RiErrorWarningFill className={cn('shrink-0 ml-2 w-4 h-4 text-text-destructive', inMessage && 'w-3.5 h-3.5')} />
          )}
          {nodeInfo.status === 'stopped' && (
            <RiAlertFill className={cn('shrink-0 ml-2 w-4 h-4 text-text-warning-secondary', inMessage && 'w-3.5 h-3.5')} />
          )}
          {nodeInfo.status === 'running' && (
            <RiLoader2Line className={cn('shrink-0 ml-2 w-4 h-4 text-text-accent', inMessage && 'w-3.5 h-3.5')} />
          )}
        </div>
        {!collapseState && !hideProcessDetail && (
          <div className='px-1 pb-1'>
            {/* The nav to the iteration detail */}
            {isIterationNode && !notShowIterationNav && (
              <div className='mt-2 mb-1 !px-2'>
                <div
                  className='flex items-center h-[34px] justify-between px-3 bg-background-section-burn border-[0.5px] border-components-panel-border rounded-lg cursor-pointer'
                  onClick={handleOnShowIterationDetail}>
                  <div className='system-sm-medium text-text-secondary'>{t('workflow.nodes.iteration.iteration', { count: nodeInfo.metadata?.iterator_length })}</div>
                  {justShowIterationNavArrow
                    ? (
                      <RiArrowRightSLine className='w-3.5 h-3.5 text-text-tertiary' />
                    )
                    : (
                      <div className='flex items-center space-x-1 text-text-accent'>
                        <div className='system-sm-regular '>{t('workflow.common.viewDetailInTracingPanel')}</div>
                        <RiArrowRightSLine className='w-3.5 h-3.5' />
                      </div>
                    )}
                </div>
                <Split className='mt-2' />
              </div>
            )}
            <div className={cn('mb-1')}>
              {nodeInfo.status === 'stopped' && (
                <StatusContainer status='stopped'>
                  {t('workflow.tracing.stopBy', { user: nodeInfo.created_by ? nodeInfo.created_by.name : 'N/A' })}
                </StatusContainer>
              )}
              {nodeInfo.status === 'failed' && (
                <StatusContainer status='failed'>
                  {nodeInfo.error}
                </StatusContainer>
              )}
            </div>
            {nodeInfo.inputs && (
              <div className={cn('mb-1')}>
                <CodeEditor
                  readOnly
                  title={<div>{t('workflow.common.input').toLocaleUpperCase()}</div>}
                  language={CodeLanguage.json}
                  value={nodeInfo.inputs}
                  isJSONStringifyBeauty
                />
              </div>
            )}
            {nodeInfo.process_data && (
              <div className={cn('mb-1')}>
                <CodeEditor
                  readOnly
                  title={<div>{t('workflow.common.processData').toLocaleUpperCase()}</div>}
                  language={CodeLanguage.json}
                  value={nodeInfo.process_data}
                  isJSONStringifyBeauty
                />
              </div>
            )}
            {nodeInfo.outputs && (
              <div>
                <CodeEditor
                  readOnly
                  title={<div>{t('workflow.common.output').toLocaleUpperCase()}</div>}
                  language={CodeLanguage.json}
                  value={nodeInfo.outputs}
                  isJSONStringifyBeauty
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default NodePanel
