'use client'
import type { FC } from 'react'
import type { WorkflowRunDetailResponse } from '@/models/log'
import type { WorkflowRunOwner } from '@/service/log'
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
  owner: WorkflowRunOwner
  runId?: string
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
  owner,
  runId,
}) => {
  const [currentTab, setCurrentTab] = useState<RunTab>(activeTab)
  const isListening = useStore((s) => s.isListening)

  useEffect(() => {
    if (isListening) setCurrentTab('DETAIL')
  }, [isListening])

  return (
    <RunSession
      key={JSON.stringify([owner, runId])}
      hideResult={hideResult}
      getResultCallback={getResultCallback}
      owner={owner}
      runId={runId}
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
  owner,
  runId,
  currentTab,
  onTabChange,
  isListening,
}: RunSessionProps) {
  const { t } = useTranslation(['runLog'])
  const ownerKey = JSON.stringify(owner)
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
      if (!runId) return
      try {
        const res = await fetchRunDetail(owner, runId)
        if (!lifetime.active || request !== lifetime.detailRequest) return
        setRunDetail(res)
        if (getResultCallback) getResultCallback(res)
      } catch (err) {
        if (lifetime.active && request === lifetime.detailRequest)
          toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        if (lifetime.active && request === lifetime.detailRequest) {
          lifetime.detailSettled = true
          if (lifetime.tracingSettled) setLoading(false)
        }
      }
    },
    [getResultCallback, owner, runId],
  )

  const getTracingList = useCallback(
    async (lifetime: RequestLifetime) => {
      const request = ++lifetime.tracingRequest
      if (!runId) return
      try {
        const nodeList = await fetchTracingList(owner, runId)
        if (lifetime.active && request === lifetime.tracingRequest) setList(nodeList)
      } catch (err) {
        if (lifetime.active && request === lifetime.tracingRequest)
          toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        if (lifetime.active && request === lifetime.tracingRequest) {
          lifetime.tracingSettled = true
          if (lifetime.detailSettled) setLoading(false)
        }
      }
    },
    [owner, runId],
  )

  const switchTab = (tab: RunTab) => {
    onTabChange(tab)
    const lifetime = requestLifetimeRef.current
    if (!lifetime?.active) return
    if (!runId) return
    if (tab === 'RESULT') void getResult(lifetime)
    void getTracingList(lifetime)
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
    if (runId) loadRecord(lifetime)
    return () => {
      lifetime.active = false
    }
    // Callers may rebuild the owner each render; reload only when it names a different run.
  }, [ownerKey, runId])

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
            <OutputPanel
              outputs={runDetail.outputs}
              error={runDetail.error ?? undefined}
              height={height}
            />
          )}
        </TabsPanel>
        <TabsPanel value="DETAIL">
          {!loading && runDetail && (
            <ResultPanel
              inputs={runDetail.inputs}
              outputs={runDetail.outputs}
              status={runDetail.status ?? ''}
              error={runDetail.error ?? undefined}
              elapsed_time={runDetail.elapsed_time ?? undefined}
              total_tokens={runDetail.total_tokens ?? undefined}
              created_at={runDetail.created_at ?? undefined}
              created_by={executor}
              steps={runDetail.total_steps ?? undefined}
              exceptionCounts={runDetail.exceptions_count ?? undefined}
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
