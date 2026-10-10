'use client'
import type { FC } from 'react'
import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracing } from '@/types/workflow'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { fetchRunDetail, fetchTracingList } from '@/service/log'
import { useStore } from '../store'
import OutputPanel from './output-panel'
import ResultPanel from './result-panel'
import StatusPanel from './status'
import TracingPanel from './tracing-panel'

type RunProps = {
  hideResult?: boolean
  activeTab?: 'RESULT' | 'DETAIL' | 'TRACING'
  getResultCallback?: (result: WorkflowRunDetailResponse) => void
  runDetailUrl: string
  tracingListUrl: string
}

type RunTab = NonNullable<RunProps['activeTab']>
type RequestLifetime = {
  active: boolean
  detailRequest: number
  tracingRequest: number
  detailSettled: boolean
  tracingSettled: boolean
}

const RunPanel: FC<RunProps> = ({
  activeTab = 'RESULT',
  hideResult,
  getResultCallback,
  runDetailUrl,
  tracingListUrl,
}) => {
  const [currentTab, setCurrentTab] = useState<RunTab>(activeTab)
  const isListening = useStore((s) => s.isListening)

  useEffect(() => {
    if (isListening) setCurrentTab('DETAIL')
  }, [isListening])

  return (
    <RunSession
      key={JSON.stringify([runDetailUrl, tracingListUrl])}
      hideResult={hideResult}
      getResultCallback={getResultCallback}
      runDetailUrl={runDetailUrl}
      tracingListUrl={tracingListUrl}
      currentTab={currentTab}
      onTabChange={setCurrentTab}
      isListening={isListening}
    />
  )
}

type RunSessionProps = Omit<RunProps, 'activeTab'> & {
  currentTab: RunTab
  onTabChange: (tab: RunTab) => void
  isListening: boolean
}

function RunSession({
  hideResult,
  getResultCallback,
  runDetailUrl,
  tracingListUrl,
  currentTab,
  onTabChange,
  isListening,
}: RunSessionProps) {
  const { t } = useTranslation(['runLog'])
  const [loading, setLoading] = useState(true)
  const [runDetail, setRunDetail] = useState<WorkflowRunDetailResponse>()
  const [list, setList] = useState<NodeTracing[]>([])
  const requestLifetimeRef = useRef<RequestLifetime | null>(null)

  const executor = useMemo(() => {
    if (runDetail?.created_by_role === 'account') return runDetail.created_by_account?.name || ''
    if (runDetail?.created_by_role === 'end_user')
      return runDetail.created_by_end_user?.session_id || ''
    return 'N/A'
  }, [runDetail])

  const getResult = useCallback(
    async (lifetime: RequestLifetime) => {
      const request = ++lifetime.detailRequest
      try {
        const res = await fetchRunDetail(runDetailUrl)
        if (!lifetime.active || request !== lifetime.detailRequest) return
        setRunDetail(res)
        if (getResultCallback) getResultCallback(res)
      } catch (err) {
        if (lifetime.active && request === lifetime.detailRequest) toast.error(`${err}`)
      } finally {
        if (lifetime.active && request === lifetime.detailRequest) {
          lifetime.detailSettled = true
          if (lifetime.tracingSettled) setLoading(false)
        }
      }
    },
    [getResultCallback, runDetailUrl],
  )

  const getTracingList = useCallback(
    async (lifetime: RequestLifetime) => {
      const request = ++lifetime.tracingRequest
      try {
        const { data: nodeList } = await fetchTracingList({
          url: tracingListUrl,
        })
        if (lifetime.active && request === lifetime.tracingRequest) setList(nodeList)
      } catch (err) {
        if (lifetime.active && request === lifetime.tracingRequest) toast.error(`${err}`)
      } finally {
        if (lifetime.active && request === lifetime.tracingRequest) {
          lifetime.tracingSettled = true
          if (lifetime.detailSettled) setLoading(false)
        }
      }
    },
    [tracingListUrl],
  )

  const switchTab = (tab: RunTab) => {
    onTabChange(tab)
    const lifetime = requestLifetimeRef.current
    if (!lifetime?.active) return
    if (tab === 'RESULT' && runDetailUrl) void getResult(lifetime)
    if (tracingListUrl) void getTracingList(lifetime)
  }

  const loadRecord = useEffectEvent((lifetime: RequestLifetime) => {
    void getResult(lifetime)
    void getTracingList(lifetime)
  })

  useEffect(() => {
    const lifetime: RequestLifetime = {
      active: true,
      detailRequest: 0,
      tracingRequest: 0,
      detailSettled: false,
      tracingSettled: false,
    }
    requestLifetimeRef.current = lifetime
    if (runDetailUrl && tracingListUrl) loadRecord(lifetime)
    return () => {
      lifetime.active = false
    }
  }, [runDetailUrl, tracingListUrl])

  const [height, setHeight] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const adjustResultHeight = () => {
    if (ref.current) setHeight(ref.current?.clientHeight - 16 - 16 - 2 - 1)
  }

  useEffect(() => {
    adjustResultHeight()
  }, [loading])

  return (
    <Tabs
      className="relative flex grow flex-col"
      value={currentTab}
      onValueChange={(value) => switchTab(value as RunTab)}
    >
      {/* tab */}
      <TabsList className="shrink-0 items-center gap-6 border-b-[0.5px] border-divider-subtle px-4">
        {!hideResult && (
          <TabsTab
            value="RESULT"
            className="py-3 system-sm-semibold-uppercase!"
            onClick={() => {
              if (currentTab === 'RESULT') switchTab('RESULT')
            }}
          >
            {t(($) => $.result, { ns: 'runLog' })}
          </TabsTab>
        )}
        <TabsTab
          value="DETAIL"
          className="py-3 system-sm-semibold-uppercase!"
          onClick={() => {
            if (currentTab === 'DETAIL') switchTab('DETAIL')
          }}
        >
          {t(($) => $.detail, { ns: 'runLog' })}
        </TabsTab>
        <TabsTab
          value="TRACING"
          className="py-3 system-sm-semibold-uppercase!"
          onClick={() => {
            if (currentTab === 'TRACING') switchTab('TRACING')
          }}
        >
          {t(($) => $.tracing, { ns: 'runLog' })}
        </TabsTab>
      </TabsList>
      {/* panel detail */}
      <div
        ref={ref}
        className="relative h-0 grow overflow-y-auto rounded-b-xl bg-components-panel-bg"
      >
        {loading && (
          <div className="flex h-full items-center justify-center bg-components-panel-bg">
            <LoadingPlaceholder />
          </div>
        )}
        <TabsPanel value="RESULT">
          {!loading && runDetail && (
            <OutputPanel outputs={runDetail.outputs} error={runDetail.error} height={height} />
          )}
        </TabsPanel>
        <TabsPanel value="DETAIL">
          {!loading && runDetail && (
            <ResultPanel
              inputs={runDetail.inputs}
              inputs_truncated={runDetail.inputs_truncated}
              outputs={runDetail.outputs}
              outputs_truncated={runDetail.outputs_truncated}
              outputs_full_content={runDetail.outputs_full_content}
              status={runDetail.status}
              error={runDetail.error}
              elapsed_time={runDetail.elapsed_time}
              total_tokens={runDetail.total_tokens}
              created_at={runDetail.created_at}
              created_by={executor}
              steps={runDetail.total_steps}
              exceptionCounts={runDetail.exceptions_count}
              isListening={isListening}
              workflowRunId={runDetail.id}
              onOpenTracingTab={() => switchTab('TRACING')}
            />
          )}
          {!loading && !runDetail && isListening && (
            <StatusPanel status={WorkflowRunningStatus.Running} isListening={true} />
          )}
        </TabsPanel>
        <TabsPanel value="TRACING">
          {!loading && <TracingPanel className="bg-background-section-burn" list={list} />}
        </TabsPanel>
      </div>
    </Tabs>
  )
}

export default RunPanel
