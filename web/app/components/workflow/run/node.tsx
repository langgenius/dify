'use client'
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'
import cn from 'classnames'
import BlockIcon from '../block-icon'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { AlertCircle, AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { CheckCircle, Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import type { NodeTracing } from '@/types/workflow'

type Props = {
  nodeInfo: NodeTracing
  collapsed: boolean
  collapseHandle: () => void
}

const NodePanel: FC<Props> = ({ nodeInfo, collapsed, collapseHandle }) => {
  const { t } = useTranslation()

  const getTime = (time: number) => {
    if (time < 1)
      return `${time * 1000} ms`
    if (time > 60)
      return `${parseInt(Math.round(time / 60).toString())} m ${(time % 60).toFixed(3)} s`
  }

  const getTokenCount = (tokens: number) => {
    if (tokens < 1000)
      return tokens
    if (tokens >= 1000 && tokens < 1000000)
      return `${parseFloat((tokens / 1000).toFixed(3))}K`
    if (tokens >= 1000000)
      return `${parseFloat((tokens / 1000000).toFixed(3))}M`
  }

  return (
    <div className='px-4 py-1'>
      <div className='group transition-all bg-white border border-gray-100 rounded-2xl shadow-xs hover:shadow-md'>
        <div
          className={cn(
            'flex items-center pl-[6px] py-3 pr-3 cursor-pointer',
            !collapsed && 'pb-2',
          )}
          onClick={collapseHandle}
        >
          <ChevronRight
            className={cn(
              'shrink-0 w-3 h-3 mr-1 text-gray-400 transition-all group-hover:text-gray-500',
              !collapsed && 'rotate-90',
            )}
          />
          <BlockIcon className='shrink-0 mr-2' type={nodeInfo.node_type} />
          <div className='grow text-gray-700 text-[13px] leading-[16px] font-semibold truncate' title={nodeInfo.title}>{nodeInfo.title}</div>
          <div className='shrink-0 text-gray-500 text-xs leading-[18px]'>{`${getTime(nodeInfo.elapsed_time)} · ${getTokenCount(nodeInfo.execution_metadata.total_tokens)} tokens`}</div>
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
            <div className='shrink-0 text-primary-600 text-[13px] leading-[16px] font-medium'>
              <Loading02 className='mr-1 w-3.5 h-3.5 animate-spin' />
              <span>Running</span>
            </div>
          )}
        </div>
        {!collapsed && (
          <div className='pb-2'>
            <div className='px-[10px] py-1'>
              {/* ###TODO### no data */}
              {nodeInfo.status === 'stopped' && (
                <div className='px-3 py-[10px] bg-[#fffaeb] rounded-lg border-[0.5px] border-[rbga(0,0,0,0.05)] text-xs leading-[18px] text-[#dc6803] shadow-xs'>{t('workflow.tracing.stopBy', { user: 'Evan' })}</div>
              )}
              {nodeInfo.status === 'failed' && (
                <div className='px-3 py-[10px] bg-[#fef3f2] rounded-lg border-[0.5px] border-[rbga(0,0,0,0.05)] text-xs leading-[18px] text-[#d92d20] shadow-xs'>{nodeInfo.error}</div>
              )}
            </div>
            <div className='px-[10px] py-1'>
              {/* ###TODO### value */}
              <CodeEditor
                readOnly
                title={<div>INPUT</div>}
                language={CodeLanguage.json}
                value={''}
                onChange={() => {}}
              />
            </div>
            <div className='px-[10px] py-1'>
              {/* ###TODO### value */}
              <CodeEditor
                readOnly
                title={<div>OUTPUT</div>}
                language={CodeLanguage.json}
                value={''}
                onChange={() => {}}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default NodePanel
