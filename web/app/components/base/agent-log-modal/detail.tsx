'use client'
import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { queryOptions, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
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
  const { t } = useTranslation(['runLog', 'common'])
  const [currentTab, setCurrentTab] = useState(activeTab)
  const {
    data: runDetail,
    isPending: loading,
    isLoadingError,
    refetch,
  } = useQuery(
    queryOptions({
      queryKey: ['log', 'agent-detail', appId, conversationID, messageID],
      queryFn: ({ signal }) =>
        fetchAgentLogDetail({
          appID: appId,
          params: { conversation_id: conversationID, message_id: messageID },
          signal,
        }),
      retry: false,
    }),
  )
  const tools = [
    ...new Set(
      runDetail?.iterations.flatMap((iteration) =>
        iteration.tool_calls.flatMap((tool) => (tool.tool_name ? [tool.tool_name] : [])),
      ),
    ),
  ]
  const switchTab = (tab: typeof currentTab) => {
    setCurrentTab(tab)
  }
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
          onClick={() => switchTab('DETAIL')}
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
          onClick={() => switchTab('TRACING')}
        >
          {t(($) => $.tracing, { ns: 'runLog' })}
        </button>
      </div>
      {/* panel detail */}
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
        {isLoadingError && (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3">
            <p className="system-sm-regular text-text-tertiary">
              {t(($) => $['errorBoundary.message'], { ns: 'common' })}
            </p>
            <Button size="small" variant="secondary" onClick={() => void refetch()}>
              {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
            </Button>
          </div>
        )}
        {!loading && !isLoadingError && currentTab === 'DETAIL' && runDetail && (
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
        {!loading && !isLoadingError && currentTab === 'TRACING' && (
          <TracingPanel list={runDetail?.iterations ?? []} />
        )}
      </div>
    </div>
  )
}
export default AgentLogDetail
