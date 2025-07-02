'use client'
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RiAlertFill,
  RiArrowRightSLine,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiLoader2Line,
} from '@remixicon/react'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import { RetryLogTrigger } from './retry-log'
import { IterationLogTrigger } from './iteration-log'
import { LoopLogTrigger } from './loop-log'
import { AgentLogTrigger } from './agent-log'
import cn from '@/utils/classnames'
import StatusContainer from '@/app/components/workflow/run/status-container'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import type {
  AgentLogItemWithChildren,
  IterationDurationMap,
  LoopDurationMap,
  LoopVariableMap,
  NodeTracing,
} from '@/types/workflow'
import ErrorHandleTip from '@/app/components/workflow/nodes/_base/components/error-handle/error-handle-tip'
import { hasRetryNode } from '@/app/components/workflow/utils'
import { useDocLink } from '@/context/i18n'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  className?: string
  nodeInfo: NodeTracing
  allExecutions?: NodeTracing[]
  inMessage?: boolean
  hideInfo?: boolean
  hideProcessDetail?: boolean
  onShowIterationDetail?: (detail: NodeTracing[][], iterDurationMap: IterationDurationMap) => void
  onShowLoopDetail?: (detail: NodeTracing[][], loopDurationMap: LoopDurationMap, loopVariableMap: LoopVariableMap) => void
  onShowRetryDetail?: (detail: NodeTracing[]) => void
  onShowAgentOrToolLog?: (detail?: AgentLogItemWithChildren) => void
  notShowIterationNav?: boolean
  notShowLoopNav?: boolean
}

const NodePanel: FC<Props> = ({
  className,
  nodeInfo,
  allExecutions,
  inMessage = false,
  hideInfo = false,
  hideProcessDetail,
  onShowIterationDetail,
  onShowLoopDetail,
  onShowRetryDetail,
  onShowAgentOrToolLog,
  notShowIterationNav,
  notShowLoopNav,
}) => {
  const [collapseState, doSetCollapseState] = useState<boolean>(true)
  const setCollapseState = useCallback((state: boolean) => {
    if (hideProcessDetail)
      return
    doSetCollapseState(state)
  }, [hideProcessDetail])
  const { t } = useTranslation()
  const docLink = useDocLink()

  const getTime = (time: number) => {
    if (time < 1)
      return `${(time * 1000).toFixed(3)} ms`
    if (time > 60)
      return `${Number.parseInt(Math.round(time / 60).toString())} m ${(time % 60).toFixed(3)} s`
    return `${time.toFixed(3)} s`
  }

  const getTokenCount = (tokens: number) => {
    if (tokens < 1000)
      return tokens
    if (tokens >= 1000 && tokens < 1000000)
      return `${Number.parseFloat((tokens / 1000).toFixed(3))}K`
    if (tokens >= 1000000)
      return `${Number.parseFloat((tokens / 1000000).toFixed(3))}M`
  }

  useEffect(() => {
    setCollapseState(!nodeInfo.expand)
  }, [nodeInfo.expand, setCollapseState])

  const isIterationNode = nodeInfo.node_type === BlockEnum.Iteration && !!nodeInfo.details?.length
  const isLoopNode = nodeInfo.node_type === BlockEnum.Loop && !!nodeInfo.details?.length
  const isRetryNode = hasRetryNode(nodeInfo.node_type) && !!nodeInfo.retryDetail?.length
  const isAgentNode = nodeInfo.node_type === BlockEnum.Agent && !!nodeInfo.agentLog?.length
  const isToolNode = nodeInfo.node_type === BlockEnum.Tool && !!nodeInfo.agentLog?.length

  const inputsTitle = useMemo(() => {
    let text = t('workflow.common.input')
    if (nodeInfo.node_type === BlockEnum.Loop)
      text = t('workflow.nodes.loop.initialLoopVariables')
    return text.toLocaleUpperCase()
  }, [nodeInfo.node_type, t])
  const processDataTitle = t('workflow.common.processData').toLocaleUpperCase()
  const outputTitle = useMemo(() => {
    let text = t('workflow.common.output')
    if (nodeInfo.node_type === BlockEnum.Loop)
      text = t('workflow.nodes.loop.finalLoopVariables')
    return text.toLocaleUpperCase()
  }, [nodeInfo.node_type, t])

  return (
    <div className={cn('px-2 py-1', className)}>
      <div className='group rounded-[10px] border border-components-panel-border bg-background-default shadow-xs transition-all hover:shadow-md'>
        <div
          className={cn(
            'flex cursor-pointer items-center pl-1 pr-3',
            hideInfo ? 'py-2 pl-2' : 'py-1.5',
            !collapseState && (hideInfo ? '!pb-1' : '!pb-1.5'),
          )}
          onClick={() => setCollapseState(!collapseState)}
        >
          {!hideProcessDetail && (
            <RiArrowRightSLine
              className={cn(
                'mr-1 h-4 w-4 shrink-0 text-text-quaternary transition-all group-hover:text-text-tertiary',
                !collapseState && 'rotate-90',
              )}
            />
          )}
          <BlockIcon size={inMessage ? 'xs' : 'sm'} className={cn('mr-2 shrink-0', inMessage && '!mr-1')} type={nodeInfo.node_type} toolIcon={nodeInfo.extras?.icon || nodeInfo.extras} />
          <Tooltip
            popupContent={
              <div className='max-w-xs'>{nodeInfo.title}</div>
            }
          >
            <div className={cn(
              'system-xs-semibold-uppercase grow truncate text-text-secondary',
              hideInfo && '!text-xs',
            )}>{nodeInfo.title}</div>
          </Tooltip>
          {nodeInfo.status !== 'running' && !hideInfo && (
            <div className='system-xs-regular shrink-0 text-text-tertiary'>{nodeInfo.execution_metadata?.total_tokens ? `${getTokenCount(nodeInfo.execution_metadata?.total_tokens || 0)} tokens · ` : ''}{`${getTime(nodeInfo.elapsed_time || 0)}`}</div>
          )}
          {nodeInfo.status === 'succeeded' && (
            <RiCheckboxCircleFill className='ml-2 h-3.5 w-3.5 shrink-0 text-text-success' />
          )}
          {nodeInfo.status === 'failed' && (
            <RiErrorWarningLine className='ml-2 h-3.5 w-3.5 shrink-0 text-text-warning' />
          )}
          {nodeInfo.status === 'stopped' && (
            <RiAlertFill className={cn('ml-2 h-4 w-4 shrink-0 text-text-warning-secondary', inMessage && 'h-3.5 w-3.5')} />
          )}
          {nodeInfo.status === 'exception' && (
            <RiAlertFill className={cn('ml-2 h-4 w-4 shrink-0 text-text-warning-secondary', inMessage && 'h-3.5 w-3.5')} />
          )}
          {nodeInfo.status === 'running' && (
            <div className='flex shrink-0 items-center text-[13px] font-medium leading-[16px] text-text-accent'>
              <span className='mr-2 text-xs font-normal'>Running</span>
              <RiLoader2Line className='h-3.5 w-3.5 animate-spin' />
            </div>
          )}
        </div>
        {!collapseState && !hideProcessDetail && (
          <div className='px-1 pb-1'>
            {/* The nav to the iteration detail */}
            {isIterationNode && !notShowIterationNav && onShowIterationDetail && (
              <IterationLogTrigger
                nodeInfo={nodeInfo}
                allExecutions={allExecutions}
                onShowIterationResultList={onShowIterationDetail}
              />
            )}
            {/* The nav to the Loop detail */}
            {isLoopNode && !notShowLoopNav && onShowLoopDetail && (
              <LoopLogTrigger
                nodeInfo={nodeInfo}
                allExecutions={allExecutions}
                onShowLoopResultList={onShowLoopDetail}
              />
            )}
            {isRetryNode && onShowRetryDetail && (
              <RetryLogTrigger
                nodeInfo={nodeInfo}
                onShowRetryResultList={onShowRetryDetail}
              />
            )}
            {
              (isAgentNode || isToolNode) && onShowAgentOrToolLog && (
                <AgentLogTrigger
                  nodeInfo={nodeInfo}
                  onShowAgentOrToolLog={onShowAgentOrToolLog}
                />
              )
            }
            <div className={cn('mb-1', hideInfo && '!px-2 !py-0.5')}>
              {(nodeInfo.status === 'stopped') && (
                <StatusContainer status='stopped'>
                  {t('workflow.tracing.stopBy', { user: nodeInfo.created_by ? nodeInfo.created_by.name : 'N/A' })}
                </StatusContainer>
              )}
              {(nodeInfo.status === 'exception') && (
                <StatusContainer status='stopped'>
                  {nodeInfo.error}
                  <a
                    href={docLink('/guides/workflow/error-handling/error-type')}
                    target='_blank'
                    className='text-text-accent'
                  >
                    {t('workflow.common.learnMore')}
                  </a>
                </StatusContainer>
              )}
              {nodeInfo.status === 'failed' && (
                <StatusContainer status='failed'>
                  {nodeInfo.error}
                </StatusContainer>
              )}
              {nodeInfo.status === 'retry' && (
                <StatusContainer status='failed'>
                  {nodeInfo.error}
                </StatusContainer>
              )}
            </div>
            {nodeInfo.inputs && (
              <div className={cn('mb-1')}>
                <CodeEditor
                  readOnly
                  title={<div>{inputsTitle}</div>}
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
                  title={<div>{processDataTitle}</div>}
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
                  title={<div>{outputTitle}</div>}
                  language={CodeLanguage.json}
                  value={nodeInfo.outputs}
                  isJSONStringifyBeauty
                  tip={<ErrorHandleTip type={nodeInfo.execution_metadata?.error_strategy} />}
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
