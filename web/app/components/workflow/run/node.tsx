'use client'
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  RiArrowRightSLine,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiLoader2Line,
} from '@remixicon/react'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import Split from '../nodes/_base/components/split'
import { Iteration } from '@/app/components/base/icons/src/vender/workflow'
import cn from '@/utils/classnames'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import Button from '@/app/components/base/button'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import type { NodeTracing } from '@/types/workflow'

type Props = {
  className?: string
  nodeInfo: NodeTracing
  hideInfo?: boolean
  hideProcessDetail?: boolean
  onShowIterationDetail?: (detail: NodeTracing[][]) => void
  notShowIterationNav?: boolean
  justShowIterationNavArrow?: boolean
}

const NodePanel: FC<Props> = ({
  className,
  nodeInfo,
  hideInfo = false,
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

  const getCount = (iteration_curr_length: number | undefined, iteration_length: number) => {
    if ((iteration_curr_length && iteration_curr_length < iteration_length) || !iteration_length)
      return iteration_curr_length

    return iteration_length
  }

  useEffect(() => {
    setCollapseState(!nodeInfo.expand)
  }, [nodeInfo.expand, setCollapseState])

  const isIterationNode = nodeInfo.node_type === BlockEnum.Iteration
  const handleOnShowIterationDetail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    onShowIterationDetail?.(nodeInfo.details || [])
  }
  return (
    <div className={cn('px-2 py-1', className)}>
      <div className='group transition-all bg-background-default border border-components-panel-border rounded-[10px] shadows-shadow-xs hover:shadow-md'>
        <div
          className={cn(
            'flex items-center pl-1 pr-3 cursor-pointer',
            hideInfo ? 'py-2' : 'py-1.5',
            !collapseState && (hideInfo ? '!pb-1' : '!pb-1.5'),
          )}
          onClick={() => setCollapseState(!collapseState)}
        >
          {!hideProcessDetail && (
            <RiArrowRightSLine
              className={cn(
                'shrink-0 w-4 h-4 mr-1 text-text-quaternary transition-all group-hover:text-text-tertiary',
                !collapseState && 'rotate-90',
              )}
            />
          )}

          <BlockIcon size={hideInfo ? 'xs' : 'sm'} className={cn('shrink-0 mr-2', hideInfo && '!mr-1')} type={nodeInfo.node_type} toolIcon={nodeInfo.extras?.icon || nodeInfo.extras} />
          <div className={cn(
            'grow text-text-secondary system-xs-semibold-uppercase truncate',
            hideInfo && '!text-xs',
          )} title={nodeInfo.title}>{nodeInfo.title}</div>
          {nodeInfo.status !== 'running' && !hideInfo && (
            <div className='shrink-0 text-text-tertiary system-xs-regular'>{nodeInfo.execution_metadata?.total_tokens ? `${getTokenCount(nodeInfo.execution_metadata?.total_tokens || 0)} tokens · ` : ''}{`${getTime(nodeInfo.elapsed_time || 0)}`}</div>
          )}
          {nodeInfo.status === 'succeeded' && (
            <RiCheckboxCircleFill className='shrink-0 ml-2 w-3.5 h-3.5 text-text-success' />
          )}
          {nodeInfo.status === 'failed' && (
            <RiErrorWarningLine className='shrink-0 ml-2 w-3.5 h-3.5 text-text-warning' />
          )}
          {nodeInfo.status === 'stopped' && (
            <AlertTriangle className='shrink-0 ml-2 w-3.5 h-3.5 text-[#F79009]' />
          )}
          {nodeInfo.status === 'running' && (
            <div className='shrink-0 flex items-center text-text-accent text-[13px] leading-[16px] font-medium'>
              <span className='mr-2 text-xs font-normal'>Running</span>
              <RiLoader2Line className='w-3.5 h-3.5 animate-spin' />
            </div>
          )}
        </div>
        {!collapseState && !hideProcessDetail && (
          <div className='pb-2'>
            {/* The nav to the iteration detail */}
            {isIterationNode && !notShowIterationNav && (
              <div className='mt-2 mb-1 !px-2'>
                <Button
                  className='flex items-center w-full self-stretch gap-2 px-3 py-2 bg-components-button-tertiary-bg-hover hover:bg-components-button-tertiary-bg-hover rounded-lg cursor-pointer border-none'
                  onClick={handleOnShowIterationDetail}
                >
                  <Iteration className='w-4 h-4 text-components-button-tertiary-text flex-shrink-0' />
                  <div className='flex-1 text-left system-sm-medium text-components-button-tertiary-text'>{t('workflow.nodes.iteration.iteration', { count: getCount(nodeInfo.details?.length, nodeInfo.metadata?.iterator_length) })}</div>
                  {justShowIterationNavArrow
                    ? (
                      <RiArrowRightSLine className='w-4 h-4 text-components-button-tertiary-text flex-shrink-0' />
                    )
                    : (
                      <div className='flex items-center space-x-1 text-[#155EEF]'>
                        <div className='text-[13px] font-normal '>{t('workflow.common.viewDetailInTracingPanel')}</div>
                        <RiArrowRightSLine className='w-4 h-4 text-components-button-tertiary-text flex-shrink-0' />
                      </div>
                    )}
                </Button>
                <Split className='mt-2' />
              </div>
            )}
            <div className={cn('px-[10px]', hideInfo && '!px-2 !py-0.5')}>
              {nodeInfo.status === 'stopped' && (
                <div className='px-3 py-[10px] bg-[#fffaeb] rounded-lg border-[0.5px] border-[rbga(0,0,0,0.05)] text-xs leading-[18px] text-[#dc6803] shadow-xs'>{t('workflow.tracing.stopBy', { user: nodeInfo.created_by ? nodeInfo.created_by.name : 'N/A' })}</div>
              )}
              {nodeInfo.status === 'failed' && (
                <div className='px-3 py-[10px] bg-[#fef3f2] rounded-lg border-[0.5px] border-[rbga(0,0,0,0.05)] text-xs leading-[18px] text-[#d92d20] shadow-xs'>{nodeInfo.error}</div>
              )}
            </div>
            {nodeInfo.inputs && (
              <div className={cn('px-[10px] py-1', hideInfo && '!px-2 !py-0.5')}>
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
              <div className={cn('px-[10px] py-1', hideInfo && '!px-2 !py-0.5')}>
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
              <div className={cn('px-[10px] py-1', hideInfo && '!px-2 !py-0.5')}>
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
