'use client'
import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { AgentLogDetailResponse } from '@/models/log'
import { cn } from '@langgenius/dify-ui/cn'
import { uniq } from 'es-toolkit/array'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toast } from '@/app/notifications'
import { fetchAgentLogDetail } from '@/service/log'
import ResultPanel from './result'
import TracingPanel from './tracing'

type AgentLogDetailProps = Readonly<{
  appId: string
  activeTab?: 'DETAIL' | 'TRACING'
  conversationID: string
  log: IChatItem
  messageID: string
}>
const AgentLogDetail: FC<AgentLogDetailProps> = ({
  appId,
  activeTab = 'DETAIL',
  conversationID,
  messageID,
  log,
}) => {
  const { t } = useTranslation(['runLog'])
  const [currentTab, setCurrentTab] = useState<'DETAIL' | 'TRACING'>(activeTab)
  return (
    <div className="relative flex grow flex-col">
      {/* tab */}
      <div className="flex shrink-0 items-center border-b-[0.5px] border-divider-regular px-4">
        <button
          type="button"
          className={cn(
            'mr-6 cursor-pointer border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-left text-[13px] leading-4.5 font-semibold text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
            currentTab === 'DETAIL' && 'border-[rgb(21,94,239)]! text-text-secondary',
          )}
          data-active={currentTab === 'DETAIL'}
          onClick={() => setCurrentTab('DETAIL')}
        >
          {t(($) => $.detail, { ns: 'runLog' })}
        </button>
        <button
          type="button"
          className={cn(
            'mr-6 cursor-pointer border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-left text-[13px] leading-4.5 font-semibold text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
            currentTab === 'TRACING' && 'border-[rgb(21,94,239)]! text-text-secondary',
          )}
          data-active={currentTab === 'TRACING'}
          onClick={() => setCurrentTab('TRACING')}
        >
          {t(($) => $.tracing, { ns: 'runLog' })}
        </button>
      </div>
      <AgentLogContent
        key={JSON.stringify([appId, conversationID, messageID])}
        appId={appId}
        conversationID={conversationID}
        messageID={messageID}
        log={log}
        currentTab={currentTab}
      />
    </div>
  )
}
type AgentLogContentProps = Omit<AgentLogDetailProps, 'activeTab'> & {
  currentTab: 'DETAIL' | 'TRACING'
}

function AgentLogContent({
  appId,
  conversationID,
  messageID,
  log,
  currentTab,
}: AgentLogContentProps) {
  const [loading, setLoading] = useState(true)
  const [runDetail, setRunDetail] = useState<AgentLogDetailResponse>()
  const tools = useMemo(
    () =>
      uniq(
        (runDetail?.iterations ?? []).flatMap((iteration) =>
          iteration.tool_calls
            .map((tool) => tool.tool_name)
            .filter((name): name is string => !!name),
        ),
      ),
    [runDetail],
  )

  useEffect(() => {
    let active = true
    fetchAgentLogDetail({
      appID: appId,
      params: { conversation_id: conversationID, message_id: messageID },
    }).then(
      (data) => {
        if (!active) return
        setRunDetail(data)
        setLoading(false)
      },
      (error) => {
        if (!active) return
        toast.error(`${error}`)
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [appId, conversationID, messageID])

  return (
    <div
      className={cn(
        'h-0 grow overflow-y-auto rounded-b-2xl bg-components-panel-bg',
        currentTab !== 'DETAIL' && 'bg-background-section!',
      )}
    >
      {loading && (
        <div className="flex h-full items-center justify-center bg-components-panel-bg">
          <LoadingPlaceholder />
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
      {!loading && currentTab === 'TRACING' && <TracingPanel list={runDetail?.iterations ?? []} />}
    </div>
  )
}

export default AgentLogDetail
