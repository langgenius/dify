'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  RiRestartFill,
} from '@remixicon/react'
import StatusPanel from './status'
import MetaData from './meta'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import ErrorHandleTip from '@/app/components/workflow/nodes/_base/components/error-handle/error-handle-tip'
import type { NodeTracing } from '@/types/workflow'
import Button from '@/app/components/base/button'

type ResultPanelProps = {
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
  retry_events?: NodeTracing[]
  onShowRetryDetail?: (retries: NodeTracing[]) => void
}

const ResultPanel: FC<ResultPanelProps> = ({
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
  retry_events,
  onShowRetryDetail,
}) => {
  const { t } = useTranslation()

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
      {
        retry_events?.length && onShowRetryDetail && (
          <div className='px-4'>
            <Button
              className='flex items-center justify-between w-full'
              variant='tertiary'
              onClick={() => onShowRetryDetail(retry_events)}
            >
              <div className='flex items-center'>
                <RiRestartFill className='mr-0.5 w-4 h-4 text-components-button-tertiary-text flex-shrink-0' />
                {t('workflow.nodes.common.retry.retries', { num: retry_events?.length })}
              </div>
              <RiArrowRightSLine className='w-4 h-4 text-components-button-tertiary-text flex-shrink-0' />
            </Button>
          </div>
        )
      }
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
