'use client'
import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { uniq } from 'es-toolkit/array'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
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
            'me-6 cursor-pointer border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-start text-[13px] leading-4.5 font-semibold text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
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
            'me-6 cursor-pointer border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-start text-[13px] leading-4.5 font-semibold text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
            currentTab === 'TRACING' && 'border-[rgb(21,94,239)]! text-text-secondary',
          )}
          data-active={currentTab === 'TRACING'}
          onClick={() => setCurrentTab('TRACING')}
        >
          {t(($) => $.tracing, { ns: 'runLog' })}
        </button>
      </div>
      <AgentLogContent
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
  const { t } = useTranslation(['common'])
  const runDetailQuery = useQuery(
    consoleQuery.apps.byAppId.agent.logs.get.queryOptions({
      input: {
        params: { app_id: appId },
        query: { conversation_id: conversationID, message_id: messageID },
      },
      retry: false,
      refetchOnWindowFocus: false,
    }),
  )
  const { data: runDetail, isPending: loading } = runDetailQuery
  const runDetailLoad = useOwnedQueryError(runDetailQuery)
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

  const loadErrorMessage = useRequestErrorMessage(runDetailLoad?.error)

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
      {!loading && runDetailLoad && loadErrorMessage && (
        <div className="p-4">
          <Alert type="error">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button size="small" loading={runDetailLoad.retrying} onClick={runDetailLoad.retry}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        </div>
      )}
      {!loading && currentTab === 'DETAIL' && runDetail && (
        <ResultPanel
          inputs={log.input}
          outputs={log.content}
          status={runDetail.meta.status}
          elapsed_time={runDetail.meta.elapsed_time ?? undefined}
          total_tokens={runDetail.meta.total_tokens}
          created_at={runDetail.meta.start_time}
          created_by={runDetail.meta.executor}
          agentMode={runDetail.meta.agent_mode}
          tools={tools}
          iterations={runDetail.iterations.length}
        />
      )}
      {!loading && !loadErrorMessage && currentTab === 'TRACING' && (
        <TracingPanel list={runDetail?.iterations ?? []} />
      )}
    </div>
  )
}

export default AgentLogDetail
