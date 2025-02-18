'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { flatten, uniq } from 'lodash-es'
import ResultPanel from './result'
import TracingPanel from './tracing'
import cn from '@/utils/classnames'
import { ToastContext } from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import { fetchAgentLogDetail } from '@/service/log'
import type { AgentIteration, AgentLogDetailResponse } from '@/models/log'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { IChatItem } from '@/app/components/base/chat/chat/type'

export type AgentLogDetailProps = {
  activeTab?: 'DETAIL' | 'TRACING'
  conversationID: string
  log: IChatItem
  messageID: string
}

const AgentLogDetail: FC<AgentLogDetailProps> = ({
  activeTab = 'DETAIL',
  conversationID,
  messageID,
  log,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [currentTab, setCurrentTab] = useState<string>(activeTab)
  const appDetail = useAppStore(s => s.appDetail)
  const [loading, setLoading] = useState<boolean>(true)
  const [runDetail, setRunDetail] = useState<AgentLogDetailResponse>()
  const [list, setList] = useState<AgentIteration[]>([])

  const tools = useMemo(() => {
    const res = uniq(flatten(runDetail?.iterations.map((iteration: any) => {
      return iteration.tool_calls.map((tool: any) => tool.tool_name).filter(Boolean)
    })).filter(Boolean))
    return res
  }, [runDetail])

  const getLogDetail = useCallback(async (appID: string, conversationID: string, messageID: string) => {
    try {
      const res = await fetchAgentLogDetail({
        appID,
        params: {
          conversation_id: conversationID,
          message_id: messageID,
        },
      })
      setRunDetail(res)
      setList(res.iterations)
    }
    catch (err) {
      notify({
        type: 'error',
        message: `${err}`,
      })
    }
  }, [notify])

  const getData = async (appID: string, conversationID: string, messageID: string) => {
    setLoading(true)
    await getLogDetail(appID, conversationID, messageID)
    setLoading(false)
  }

  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
  }

  useEffect(() => {
    // fetch data
    if (appDetail)
      getData(appDetail.id, conversationID, messageID)
  }, [appDetail, conversationID, messageID])

  return (
    <div className='relative flex grow flex-col'>
      {/* tab */}
      <div className='border-divider-regular flex shrink-0 items-center border-b-[0.5px] px-4'>
        <div
          className={cn(
            'text-text-tertiary mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px]',
            currentTab === 'DETAIL' && 'text-text-secondary !border-[rgb(21,94,239)]',
          )}
          onClick={() => switchTab('DETAIL')}
        >{t('runLog.detail')}</div>
        <div
          className={cn(
            'text-text-tertiary mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px]',
            currentTab === 'TRACING' && 'text-text-secondary !border-[rgb(21,94,239)]',
          )}
          onClick={() => switchTab('TRACING')}
        >{t('runLog.tracing')}</div>
      </div>
      {/* panel detail */}
      <div className={cn('bg-components-panel-bg h-0 grow overflow-y-auto rounded-b-2xl', currentTab !== 'DETAIL' && '!bg-background-section')}>
        {loading && (
          <div className='bg-components-panel-bg flex h-full items-center justify-center'>
            <Loading />
          </div>
        )}
        {!loading && currentTab === 'DETAIL' && runDetail && (
          <ResultPanel
            inputs={log.input}
            outputs={log.content}
            status={runDetail.meta.status}
            error={runDetail.meta.error}
            elapsed_time={runDetail.meta.elapsed_time}
            total_tokens={runDetail.meta.total_tokens}
            created_at={runDetail.meta.start_time}
            created_by={runDetail.meta.executor}
            agentMode={runDetail.meta.agent_mode}
            tools={tools}
            iterations={runDetail.iterations.length}
          />
        )}
        {!loading && currentTab === 'TRACING' && (
          <TracingPanel
            list={list}
          />
        )}
      </div>
    </div>
  )
}

export default AgentLogDetail
