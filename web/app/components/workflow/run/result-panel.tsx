'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import StatusPanel from './status'
import MetaData from './meta'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import ErrorHandleTip from '@/app/components/workflow/nodes/_base/components/error-handle/error-handle-tip'
import type {
  AgentLogItemWithChildren,
  NodeTracing,
} from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { hasRetryNode } from '@/app/components/workflow/utils'
import { IterationLogTrigger } from '@/app/components/workflow/run/iteration-log'
import { LoopLogTrigger } from '@/app/components/workflow/run/loop-log'
import { RetryLogTrigger } from '@/app/components/workflow/run/retry-log'
import { AgentLogTrigger } from '@/app/components/workflow/run/agent-log'
import LargeDataAlert from '../variable-inspect/large-data-alert'

export type ResultPanelProps = {
  nodeInfo?: NodeTracing
  inputs?: string
  inputs_truncated?: boolean
  process_data?: string
  process_data_truncated?: boolean
  outputs?: string | Record<string, any>
  outputs_truncated?: boolean
  outputs_full_content?: {
    download_url: string
  }
  status: string
  error?: string
  elapsed_time?: number
  total_tokens?: number
  created_at?: number
  created_by?: string
  finished_at?: number
  steps?: number
  showSteps?: boolean
  exceptionCounts?: number
  execution_metadata?: any
  handleShowIterationResultList?: (detail: NodeTracing[][], iterDurationMap: any) => void
  handleShowLoopResultList?: (detail: NodeTracing[][], loopDurationMap: any) => void
  onShowRetryDetail?: (detail: NodeTracing[]) => void
  handleShowAgentOrToolLog?: (detail?: AgentLogItemWithChildren) => void
}

const ResultPanel: FC<ResultPanelProps> = ({
  nodeInfo,
  inputs,
  inputs_truncated,
  process_data,
  process_data_truncated,
  outputs,
  outputs_truncated,
  outputs_full_content,
  status,
  error,
  elapsed_time,
  total_tokens,
  created_at,
  created_by,
  steps,
  showSteps,
  exceptionCounts,
  execution_metadata,
  handleShowIterationResultList,
  handleShowLoopResultList,
  onShowRetryDetail,
  handleShowAgentOrToolLog,
}) => {
  const { t } = useTranslation()
  const isIterationNode = nodeInfo?.node_type === BlockEnum.Iteration && !!nodeInfo?.details?.length
  const isLoopNode = nodeInfo?.node_type === BlockEnum.Loop && !!nodeInfo?.details?.length
  const isRetryNode = hasRetryNode(nodeInfo?.node_type) && !!nodeInfo?.retryDetail?.length
  const isAgentNode = nodeInfo?.node_type === BlockEnum.Agent && !!nodeInfo?.agentLog?.length
  const isToolNode = nodeInfo?.node_type === BlockEnum.Tool && !!nodeInfo?.agentLog?.length

  return (
    <div className='bg-components-panel-bg py-2'>
      <div className='px-4 py-2'>
        <StatusPanel
          status={status}
          time={elapsed_time}
          tokens={total_tokens}
          error={error}
          exceptionCounts={exceptionCounts}
        />
      </div>
      <div className='px-4'>
        {
          isIterationNode && handleShowIterationResultList && (
            <IterationLogTrigger
              nodeInfo={nodeInfo}
              onShowIterationResultList={handleShowIterationResultList}
            />
          )
        }
        {
          isLoopNode && handleShowLoopResultList && (
            <LoopLogTrigger
              nodeInfo={nodeInfo}
              onShowLoopResultList={handleShowLoopResultList}
            />
          )
        }
        {
          isRetryNode && onShowRetryDetail && (
            <RetryLogTrigger
              nodeInfo={nodeInfo}
              onShowRetryResultList={onShowRetryDetail}
            />
          )
        }
        {
          (isAgentNode || isToolNode) && handleShowAgentOrToolLog && (
            <AgentLogTrigger
              nodeInfo={nodeInfo}
              onShowAgentOrToolLog={handleShowAgentOrToolLog}
            />
          )
        }
      </div>
      <div className='flex flex-col gap-2 px-4 py-2'>
        <CodeEditor
          readOnly
          title={<div>{t('workflow.common.input').toLocaleUpperCase()}</div>}
          language={CodeLanguage.json}
          value={inputs}
          isJSONStringifyBeauty
          footer={inputs_truncated && <LargeDataAlert textHasNoExport className='mx-1 mb-1 mt-2 h-7' />}
        />
        {process_data && (
          <CodeEditor
            readOnly
            title={<div>{t('workflow.common.processData').toLocaleUpperCase()}</div>}
            language={CodeLanguage.json}
            value={process_data}
            isJSONStringifyBeauty
            footer={process_data_truncated && <LargeDataAlert textHasNoExport className='mx-1 mb-1 mt-2 h-7' />}
          />
        )}
        {(outputs || status === 'running') && (
          <CodeEditor
            readOnly
            title={<div>{t('workflow.common.output').toLocaleUpperCase()}</div>}
            language={CodeLanguage.json}
            value={outputs}
            isJSONStringifyBeauty
            tip={<ErrorHandleTip type={execution_metadata?.error_strategy} />}
            footer={outputs_truncated && <LargeDataAlert textHasNoExport downloadUrl={outputs_full_content?.download_url} className='mx-1 mb-1 mt-2 h-7' />}
          />
        )}
      </div>
      <div className='px-4 py-2'>
        <div className='divider-subtle h-[0.5px]' />
      </div>
      <div className='px-4 py-2'>
        <MetaData
          status={status}
          executor={created_by}
          startTime={created_at}
          time={elapsed_time}
          tokens={total_tokens}
          steps={steps}
          showSteps={showSteps}
        />
      </div>
    </div>
  )
}

export default ResultPanel
