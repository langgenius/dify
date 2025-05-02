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
import { RetryLogTrigger } from '@/app/components/workflow/run/retry-log'
import { AgentLogTrigger } from '@/app/components/workflow/run/agent-log'

type ResultPanelProps = {
  nodeInfo?: NodeTracing
  inputs?: string
  process_data?: string
  outputs?: string
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
  onShowRetryDetail?: (detail: NodeTracing[]) => void
  handleShowAgentOrToolLog?: (detail?: AgentLogItemWithChildren) => void
}

const ResultPanel: FC<ResultPanelProps> = ({
  nodeInfo,
  inputs,
  process_data,
  outputs,
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
  onShowRetryDetail,
  handleShowAgentOrToolLog,
}) => {
  const { t } = useTranslation()
  const isIterationNode = nodeInfo?.node_type === BlockEnum.Iteration && !!nodeInfo?.details?.length
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
      <div className='px-4 py-2 flex flex-col gap-2'>
        <CodeEditor
          readOnly
          title={<div>{t('workflow.common.input').toLocaleUpperCase()}</div>}
          language={CodeLanguage.json}
          value={inputs}
          isJSONStringifyBeauty
        />
        {process_data && (
          <CodeEditor
            readOnly
            title={<div>{t('workflow.common.processData').toLocaleUpperCase()}</div>}
            language={CodeLanguage.json}
            value={process_data}
            isJSONStringifyBeauty
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
          />
        )}
      </div>
      <div className='px-4 py-2'>
        <div className='h-[0.5px] divider-subtle' />
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
