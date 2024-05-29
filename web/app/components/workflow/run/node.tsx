'use client'
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import cn from 'classnames'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import Split from '../nodes/_base/components/split'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { AlertCircle, AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { CheckCircle, Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import { ArrowNarrowRight, ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
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
    <div className={cn('px-4 py-1', className, hideInfo && '!p-0')}>
      <div className={cn('group transition-all bg-white border border-gray-100 rounded-2xl shadow-xs hover:shadow-md', hideInfo && '!rounded-lg')}>
        <div
          className={cn(
            'flex items-center pl-[6px] pr-3 cursor-pointer',
            hideInfo ? 'py-2' : 'py-3',
            !collapseState && (hideInfo ? '!pb-1' : '!pb-2'),
          )}
          onClick={() => setCollapseState(!collapseState)}
        >
          {!hideProcessDetail && (
            <ChevronRight
              className={cn(
                'shrink-0 w-3 h-3 mr-1 text-gray-400 transition-all group-hover:text-gray-500',
                !collapseState && 'rotate-90',
              )}
            />
          )}

          <BlockIcon size={hideInfo ? 'xs' : 'sm'} className={cn('shrink-0 mr-2', hideInfo && '!mr-1')} type={nodeInfo.node_type} toolIcon={nodeInfo.extras?.icon || nodeInfo.extras} />
          <div className={cn(
            'grow text-gray-700 text-[13px] leading-[16px] font-semibold truncate',
            hideInfo && '!text-xs',
          )} title={nodeInfo.title}>{nodeInfo.title}</div>
          {nodeInfo.status !== 'running' && !hideInfo && (
            <div className='shrink-0 text-gray-500 text-xs leading-[18px]'>{`${getTime(nodeInfo.elapsed_time || 0)} · ${getTokenCount(nodeInfo.execution_metadata?.total_tokens || 0)} tokens`}</div>
          )}
          {nodeInfo.status === 'succeeded' && (
            <CheckCircle className='shrink-0 ml-2 w-3.5 h-3.5 text-[#12B76A]' />
          )}
          {nodeInfo.status === 'failed' && (
            <AlertCircle className='shrink-0 ml-2 w-3.5 h-3.5 text-[#F04438]' />
          )}
          {nodeInfo.status === 'stopped' && (
            <AlertTriangle className='shrink-0 ml-2 w-3.5 h-3.5 text-[#F79009]' />
          )}
          {nodeInfo.status === 'running' && (
            <div className='shrink-0 flex items-center text-primary-600 text-[13px] leading-[16px] font-medium'>
              <span className='mr-2 text-xs font-normal'>Running</span>
              <Loading02 className='w-3.5 h-3.5 animate-spin' />
            </div>
          )}
        </div>
        {!collapseState && !hideProcessDetail && (
          <div className='pb-2'>
            {/* The nav to the iteration detail */}
            {isIterationNode && !notShowIterationNav && (
              <div className='mt-2 mb-1 !px-2'>
                <div
                  className='flex items-center h-[34px] justify-between px-3 bg-gray-100 border-[0.5px] border-gray-200 rounded-lg cursor-pointer'
                  onClick={handleOnShowIterationDetail}>
                  <div className='leading-[18px] text-[13px] font-medium text-gray-700'>{t('workflow.nodes.iteration.iteration', { count: nodeInfo.metadata?.iterator_length || (nodeInfo.execution_metadata?.steps_boundary?.length - 1) })}</div>
                  {justShowIterationNavArrow
                    ? (
                      <ArrowNarrowRight className='w-3.5 h-3.5 text-gray-500' />
                    )
                    : (
                      <div className='flex items-center space-x-1 text-[#155EEF]'>
                        <div className='text-[13px] font-normal '>{t('workflow.common.viewDetailInTracingPanel')}</div>
                        <ArrowNarrowRight className='w-3.5 h-3.5' />
                      </div>
                    )}
                </div>
                <Split className='mt-2' />
              </div>
            )}
            <div className={cn('px-[10px] py-1', hideInfo && '!px-2 !py-0.5')}>
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
