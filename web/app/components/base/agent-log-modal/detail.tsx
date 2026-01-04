'use client'
import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { AgentIteration, AgentLogDetailResponse } from '@/models/log'
import { uniq } from 'es-toolkit/array'
import { flatten } from 'es-toolkit/compat'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { ToastContext } from '@/app/components/base/toast'
import { fetchAgentLogDetail } from '@/service/log'
import { cn } from '@/utils/classnames'
import ResultPanel from './result'
import TracingPanel from './tracing'

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
    const res = uniq(flatten(runDetail?.iterations.map((iteration) => {
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
    <div className="relative flex grow flex-col">
      {/* tab */}
      <div className="flex shrink-0 items-center border-b-[0.5px] border-divider-regular px-4">
        <div
          className={cn(
            'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
            currentTab === 'DETAIL' && '!border-[rgb(21,94,239)] text-text-secondary',
          )}
          onClick={() => switchTab('DETAIL')}
        >
          {t('detail', { ns: 'runLog' })}
        </div>
        <div
          className={cn(
            'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-text-tertiary',
            currentTab === 'TRACING' && '!border-[rgb(21,94,239)] text-text-secondary',
          )}
          onClick={() => switchTab('TRACING')}
        >
          {t('tracing', { ns: 'runLog' })}
        </div>
      </div>
      {/* panel detail */}
      <div className={cn('h-0 grow overflow-y-auto rounded-b-2xl bg-components-panel-bg', currentTab !== 'DETAIL' && '!bg-background-section')}>
        {loading && (
          <div className="flex h-full items-center justify-center bg-components-panel-bg">
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
