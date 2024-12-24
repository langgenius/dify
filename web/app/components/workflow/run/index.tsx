'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import OutputPanel from './output-panel'
import ResultPanel from './result-panel'
import TracingPanel from './tracing-panel'
import IterationResultPanel from './iteration-result-panel'
import RetryResultPanel from './retry-result-panel'
import cn from '@/utils/classnames'
import { ToastContext } from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import { fetchRunDetail, fetchTracingList } from '@/service/log'
import type { IterationDurationMap, NodeTracing } from '@/types/workflow'
import type { WorkflowRunDetailResponse } from '@/models/log'
import { useStore as useAppStore } from '@/app/components/app/store'
import formatNodeList from './utils/format-to-tracing-node-list'
export type RunProps = {
  hideResult?: boolean
  activeTab?: 'RESULT' | 'DETAIL' | 'TRACING'
  runID: string
  getResultCallback?: (result: WorkflowRunDetailResponse) => void
}

const RunPanel: FC<RunProps> = ({ hideResult, activeTab = 'RESULT', runID, getResultCallback }) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [currentTab, setCurrentTab] = useState<string>(activeTab)
  const appDetail = useAppStore(state => state.appDetail)
  const [loading, setLoading] = useState<boolean>(true)
  const [runDetail, setRunDetail] = useState<WorkflowRunDetailResponse>()
  const [list, setList] = useState<NodeTracing[]>([])

  const executor = useMemo(() => {
    if (runDetail?.created_by_role === 'account')
      return runDetail.created_by_account?.name || ''
    if (runDetail?.created_by_role === 'end_user')
      return runDetail.created_by_end_user?.session_id || ''
    return 'N/A'
  }, [runDetail])

  const getResult = useCallback(async (appID: string, runID: string) => {
    try {
      const res = await fetchRunDetail({
        appID,
        runID,
      })
      setRunDetail(res)
      if (getResultCallback)
        getResultCallback(res)
    }
    catch (err) {
      notify({
        type: 'error',
        message: `${err}`,
      })
    }
  }, [notify, getResultCallback])

  const getTracingList = useCallback(async (appID: string, runID: string) => {
    try {
      const { data: nodeList } = await fetchTracingList({
        url: `/apps/${appID}/workflow-runs/${runID}/node-executions`,
      })
      setList(formatNodeList(nodeList))
    }
    catch (err) {
      notify({
        type: 'error',
        message: `${err}`,
      })
    }
  }, [notify])

  const getData = async (appID: string, runID: string) => {
    setLoading(true)
    await getResult(appID, runID)
    await getTracingList(appID, runID)
    setLoading(false)
  }

  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
    if (tab === 'RESULT')
      appDetail?.id && await getResult(appDetail.id, runID)
    appDetail?.id && await getTracingList(appDetail.id, runID)
  }

  useEffect(() => {
    // fetch data
    if (appDetail && runID)
      getData(appDetail.id, runID)
  }, [appDetail, runID])

  const [height, setHeight] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const adjustResultHeight = () => {
    if (ref.current)
      setHeight(ref.current?.clientHeight - 16 - 16 - 2 - 1)
  }

  useEffect(() => {
    adjustResultHeight()
  }, [loading])

  const [iterationRunResult, setIterationRunResult] = useState<NodeTracing[][]>([])
  const [iterDurationMap, setIterDurationMap] = useState<IterationDurationMap>({})
  const [retryRunResult, setRetryRunResult] = useState<NodeTracing[]>([])
  const [isShowIterationDetail, {
    setTrue: doShowIterationDetail,
    setFalse: doHideIterationDetail,
  }] = useBoolean(false)
  const [isShowRetryDetail, {
    setTrue: doShowRetryDetail,
    setFalse: doHideRetryDetail,
  }] = useBoolean(false)

  const handleShowIterationDetail = useCallback((detail: NodeTracing[][], iterDurationMap: IterationDurationMap) => {
    setIterationRunResult(detail)
    doShowIterationDetail()
    setIterDurationMap(iterDurationMap)
  }, [doShowIterationDetail, setIterationRunResult, setIterDurationMap])

  const handleShowRetryDetail = useCallback((detail: NodeTracing[]) => {
    setRetryRunResult(detail)
    doShowRetryDetail()
  }, [doShowRetryDetail, setRetryRunResult])

  if (isShowIterationDetail) {
    return (
      <div className='grow relative flex flex-col'>
        <IterationResultPanel
          list={iterationRunResult}
          onHide={doHideIterationDetail}
          onBack={doHideIterationDetail}
          iterDurationMap={iterDurationMap}
        />
      </div>
    )
  }

  return (
    <div className='grow relative flex flex-col'>
      {/* tab */}
      <div className='shrink-0 flex items-center px-4 border-b-[0.5px] border-divider-subtle'>
        {!hideResult && (
          <div
            className={cn(
              'mr-6 py-3 border-b-2 border-transparent system-sm-semibold-uppercase text-text-tertiary cursor-pointer',
              currentTab === 'RESULT' && '!border-util-colors-blue-brand-blue-brand-600 text-text-primary',
            )}
            onClick={() => switchTab('RESULT')}
          >{t('runLog.result')}</div>
        )}
        <div
          className={cn(
            'mr-6 py-3 border-b-2 border-transparent system-sm-semibold-uppercase text-text-tertiary cursor-pointer',
            currentTab === 'DETAIL' && '!border-util-colors-blue-brand-blue-brand-600 text-text-primary',
          )}
          onClick={() => switchTab('DETAIL')}
        >{t('runLog.detail')}</div>
        <div
          className={cn(
            'mr-6 py-3 border-b-2 border-transparent system-sm-semibold-uppercase text-text-tertiary cursor-pointer',
            currentTab === 'TRACING' && '!border-util-colors-blue-brand-blue-brand-600 text-text-primary',
          )}
          onClick={() => switchTab('TRACING')}
        >{t('runLog.tracing')}</div>
      </div>
      {/* panel detail */}
      <div ref={ref} className={cn('grow bg-components-panel-bg h-0 overflow-y-auto rounded-b-2xl', currentTab !== 'DETAIL' && '!bg-background-section-burn')}>
        {loading && (
          <div className='flex h-full items-center justify-center bg-components-panel-bg'>
            <Loading />
          </div>
        )}
        {!loading && currentTab === 'RESULT' && runDetail && (
          <OutputPanel
            outputs={runDetail.outputs}
            error={runDetail.error}
            height={height}
          />
        )}
        {!loading && currentTab === 'DETAIL' && runDetail && (
          <ResultPanel
            inputs={runDetail.inputs}
            outputs={runDetail.outputs}
            status={runDetail.status}
            error={runDetail.error}
            elapsed_time={runDetail.elapsed_time}
            total_tokens={runDetail.total_tokens}
            created_at={runDetail.created_at}
            created_by={executor}
            steps={runDetail.total_steps}
            exceptionCounts={runDetail.exceptions_count}
          />
        )}
        {!loading && currentTab === 'TRACING' && !isShowRetryDetail && (
          <TracingPanel
            className='bg-background-section-burn'
            list={list}
            onShowIterationDetail={handleShowIterationDetail}
            onShowRetryDetail={handleShowRetryDetail}
          />
        )}
        {
          !loading && currentTab === 'TRACING' && isShowRetryDetail && (
            <RetryResultPanel
              list={retryRunResult}
              onBack={doHideRetryDetail}
            />
          )
        }
      </div>
    </div>
  )
}

export default RunPanel
