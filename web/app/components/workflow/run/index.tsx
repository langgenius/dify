'use client'
import type { FC } from 'react'
import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracing } from '@/types/workflow'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  appId?: string
  hideResult?: boolean
  activeTab?: 'RESULT' | 'DETAIL' | 'TRACING'
  getResultCallback?: (result: WorkflowRunDetailResponse) => void
  runDetailUrl: string
  tracingListUrl: string
}

const RunPanel: FC<RunProps> = ({
  appId,
  hideResult,
  activeTab = 'RESULT',
  getResultCallback,
  runDetailUrl,
  tracingListUrl,
}) => {
  const { t } = useTranslation()
  const [currentTab, setCurrentTab] = useState<string>(activeTab)
  const [loading, setLoading] = useState<boolean>(true)
  const [runDetail, setRunDetail] = useState<WorkflowRunDetailResponse>()
  const [list, setList] = useState<NodeTracing[]>([])
  const isListening = useStore((s) => s.isListening)

  const executor = useMemo(() => {
    if (runDetail?.created_by_role === 'account') return runDetail.created_by_account?.name || ''
    if (runDetail?.created_by_role === 'end_user')
      return runDetail.created_by_end_user?.session_id || ''
    return 'N/A'
  }, [runDetail])

  const getResult = useCallback(async () => {
    try {
      const res = await fetchRunDetail(runDetailUrl)
      setRunDetail(res)
      if (getResultCallback) getResultCallback(res)
    } catch (err) {
      toast.error(`${err}`)
    }
  }, [getResultCallback, runDetailUrl])

  const getTracingList = useCallback(async () => {
    try {
      const { data: nodeList } = await fetchTracingList({
        url: tracingListUrl,
      })
      setList(nodeList)
    } catch (err) {
      toast.error(`${err}`)
    }
  }, [tracingListUrl])

  const getData = useCallback(async () => {
    setLoading(true)
    await getResult()
    await getTracingList()
    setLoading(false)
  }, [getResult, getTracingList])

  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
    if (tab === 'RESULT') {
      if (runDetailUrl) await getResult()
    }
    if (tracingListUrl) await getTracingList()
  }

  useEffect(() => {
    if (isListening) setCurrentTab('DETAIL')
  }, [isListening])

  useEffect(() => {
    // fetch data
    if (runDetailUrl && tracingListUrl) getData()
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
      onValueChange={(value) => switchTab(value as string)}
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
          {!loading && (
            <TracingPanel
              key={runDetail?.id}
              className="bg-background-section-burn"
              list={list}
              workflowRun={
                appId && runDetail
                  ? { appId, runId: runDetail.id, status: runDetail.status }
                  : undefined
              }
            />
          )}
        </TabsPanel>
      </div>
    </Tabs>
  )
}

export default RunPanel
