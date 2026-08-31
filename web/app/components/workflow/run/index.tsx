'use client'
import type { FC } from 'react'
import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracing } from '@/types/workflow'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import DifyBuilderEntry from '@/app/components/workflow/dify-builder-entry'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
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
  onFixRun?: (runId: string) => void
  fixWithBuilderDisabled?: boolean
}
type RunTab = NonNullable<RunProps['activeTab']>

const RunPanel: FC<RunProps> = ({
  hideResult,
  activeTab = 'RESULT',
  getResultCallback,
  runDetailUrl,
  tracingListUrl,
  onFixRun,
  fixWithBuilderDisabled,
}) => {
  const { t } = useTranslation()
  const [currentTab, setCurrentTab] = useState<RunTab>(activeTab)
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

  const switchTab = async (tab: RunTab) => {
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
    if (runDetailUrl && tracingListUrl) void getData()
  }, [getData, runDetailUrl, tracingListUrl])

  const [height, setHeight] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const adjustResultHeight = () => {
    if (ref.current) setHeight(ref.current?.clientHeight - 16 - 16 - 2 - 1)
  }

  useEffect(() => {
    adjustResultHeight()
  }, [loading])

  return (
    <div className="relative flex grow flex-col">
      {/* tab */}
      <div className="flex shrink-0 items-center border-b-[0.5px] border-divider-subtle px-4">
        {!hideResult && (
          <button
            type="button"
            aria-pressed={currentTab === 'RESULT'}
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 system-sm-semibold-uppercase text-text-tertiary',
              currentTab === 'RESULT' &&
                'border-util-colors-blue-brand-blue-brand-600! text-text-primary',
            )}
            onClick={() => void switchTab('RESULT')}
          >
            {t(($) => $.result, { ns: 'runLog' })}
          </button>
        )}
        <button
          type="button"
          aria-pressed={currentTab === 'DETAIL'}
          className={cn(
            'mr-6 cursor-pointer border-b-2 border-transparent py-3 system-sm-semibold-uppercase text-text-tertiary',
            currentTab === 'DETAIL' &&
              'border-util-colors-blue-brand-blue-brand-600! text-text-primary',
          )}
          onClick={() => void switchTab('DETAIL')}
        >
          {t(($) => $.detail, { ns: 'runLog' })}
        </button>
        <button
          type="button"
          aria-pressed={currentTab === 'TRACING'}
          className={cn(
            'mr-6 cursor-pointer border-b-2 border-transparent py-3 system-sm-semibold-uppercase text-text-tertiary',
            currentTab === 'TRACING' &&
              'border-util-colors-blue-brand-blue-brand-600! text-text-primary',
          )}
          onClick={() => void switchTab('TRACING')}
        >
          {t(($) => $.tracing, { ns: 'runLog' })}
        </button>
      </div>
      {/* panel detail */}
      <div
        ref={ref}
        className={cn('relative h-0 grow overflow-y-auto rounded-b-xl bg-components-panel-bg')}
      >
        {loading && (
          <div className="flex h-full items-center justify-center bg-components-panel-bg">
            <Loading />
          </div>
        )}
        {!loading && currentTab === 'RESULT' && runDetail && (
          <>
            <OutputPanel outputs={runDetail.outputs} error={runDetail.error} height={height} />
            {runDetail.status === WorkflowRunningStatus.Failed && runDetail.id && onFixRun && (
              <div className="px-6 pb-4">
                <DifyBuilderEntry
                  label={t(($) => $['difyBuilder.fixWithAppBuilder'], { ns: 'workflow' })}
                  description={t(($) => $['difyBuilder.runFixScopeDescription'], {
                    ns: 'workflow',
                  })}
                  disabled={fixWithBuilderDisabled}
                  onClick={() => onFixRun(runDetail.id)}
                />
              </div>
            )}
          </>
        )}
        {!loading && currentTab === 'DETAIL' && runDetail && (
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
            onOpenTracingTab={() => void switchTab('TRACING')}
            onFixRun={onFixRun}
            fixWithBuilderDisabled={fixWithBuilderDisabled}
          />
        )}
        {!loading && currentTab === 'DETAIL' && !runDetail && isListening && (
          <StatusPanel status={WorkflowRunningStatus.Running} isListening={true} />
        )}
        {!loading && currentTab === 'TRACING' && (
          <TracingPanel className="bg-background-section-burn" list={list} />
        )}
      </div>
    </div>
  )
}

export default RunPanel
