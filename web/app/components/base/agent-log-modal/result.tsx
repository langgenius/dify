'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import StatusPanel from '@/app/components/workflow/run/status'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'

type ResultPanelProps = {
  status: string
  elapsed_time?: number
  total_tokens?: number
  error?: string
  inputs?: any
  outputs?: any
  created_by?: string
  created_at?: string
  agentMode?: string
  tools?: string[]
  iterations?: number
}

const ResultPanel: FC<ResultPanelProps> = ({
  status,
  elapsed_time,
  total_tokens,
  error,
  inputs,
  outputs,
  created_by,
  created_at = 0,
  agentMode,
  tools,
  iterations,
}) => {
  const { t } = useTranslation()

  return (
    <div className='bg-white py-2'>
      <div className='px-4 py-2'>
        <StatusPanel
          status='succeeded'
          time={elapsed_time}
          tokens={total_tokens}
          error={error}
        />
      </div>
      <div className='px-4 py-2 flex flex-col gap-2'>
        <CodeEditor
          readOnly
          title={<div>INPUT</div>}
          language={CodeLanguage.json}
          value={inputs}
          isJSONStringifyBeauty
        />
        <CodeEditor
          readOnly
          title={<div>OUTPUT</div>}
          language={CodeLanguage.json}
          value={outputs}
          isJSONStringifyBeauty
        />
      </div>
      <div className='px-4 py-2'>
        <div className='h-[0.5px] bg-black opacity-5' />
      </div>
      <div className='px-4 py-2'>
        <div className='relative'>
          <div className='h-6 leading-6 text-gray-500 text-xs font-medium'>{t('runLog.meta.title')}</div>
          <div className='py-1'>
            <div className='flex'>
              <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.status')}</div>
              <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
                <span>SUCCESS</span>
              </div>
            </div>
            <div className='flex'>
              <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.executor')}</div>
              <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
                <span>{created_by || 'N/A'}</span>
              </div>
            </div>
            <div className='flex'>
              <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.startTime')}</div>
              <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
                <span>{dayjs(created_at).format('YYYY-MM-DD hh:mm:ss')}</span>
              </div>
            </div>
            <div className='flex'>
              <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.time')}</div>
              <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
                <span>{`${elapsed_time?.toFixed(3)}s`}</span>
              </div>
            </div>
            <div className='flex'>
              <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.tokens')}</div>
              <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
                <span>{`${total_tokens || 0} Tokens`}</span>
              </div>
            </div>
            <div className='flex'>
              <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('appLog.agentLogDetail.agentMode')}</div>
              <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
                <span>{agentMode === 'function_call' ? t('appDebug.agent.agentModeType.functionCall') : t('appDebug.agent.agentModeType.ReACT')}</span>
              </div>
            </div>
            <div className='flex'>
              <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('appLog.agentLogDetail.toolUsed')}</div>
              <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
                <span>{tools?.length ? tools?.join(', ') : 'Null'}</span>
              </div>
            </div>
            <div className='flex'>
              <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('appLog.agentLogDetail.iterations')}</div>
              <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
                <span>{iterations}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ResultPanel
