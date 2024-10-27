'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import StatusPanel from './status'
import MetaData from './meta'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'

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
}) => {
  const { t } = useTranslation()
  return (
    <div className='bg-white py-2'>
      <div className='px-4 py-2'>
        <StatusPanel
          status={status}
          time={elapsed_time}
          tokens={total_tokens}
          error={error}
        />
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
          />
        )}
      </div>
      <div className='px-4 py-2'>
        <div className='h-[0.5px] bg-black opacity-5' />
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
