'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CrawlResultItem } from '@/models/datasets'
import Header from '@/app/components/datasets/create/website/base/header'
import Options from './options'
import Crawling from './crawling'
import ErrorMessage from './error-message'
import CrawledResult from './crawled-result'
import {
  useDraftDatasourceNodeRun,
  useDraftDatasourceNodeRunStatus,
  useDraftPipelinePreProcessingParams,
  usePublishedDatasourceNodeRun,
  usePublishedDatasourceNodeRunStatus,
  usePublishedPipelinePreProcessingParams,
} from '@/service/use-pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'
import { sleep } from '@/utils'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type CrawlerProps = {
  nodeId: string
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  headerInfo: {
    title: string
    docTitle: string
    docLink: string
  }
  onPreview?: (payload: CrawlResultItem) => void
  isInPipeline?: boolean
}

enum Step {
  init = 'init',
  running = 'running',
  finished = 'finished',
}

const Crawler = ({
  nodeId,
  checkedCrawlResult,
  headerInfo,
  onCheckedCrawlResultChange,
  onPreview,
  isInPipeline = false,
}: CrawlerProps) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(Step.init)
  const [controlFoldOptions, setControlFoldOptions] = useState<number>(0)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)

  const usePreProcessingParams = useRef(!isInPipeline ? usePublishedPipelinePreProcessingParams : useDraftPipelinePreProcessingParams)
  const { data: paramsConfig } = usePreProcessingParams.current({
    pipeline_id: pipelineId!,
    node_id: nodeId,
  }, !!pipelineId && !!nodeId)

  useEffect(() => {
    if (step !== Step.init)
      setControlFoldOptions(Date.now())
  }, [step])

  const isInit = step === Step.init
  const isCrawlFinished = step === Step.finished
  const isRunning = step === Step.running
  const [crawlResult, setCrawlResult] = useState<{
    result: CrawlResultItem[]
    time_consuming: number | string
  } | undefined>(undefined)
  const [crawlErrorMessage, setCrawlErrorMessage] = useState('')
  const showError = isCrawlFinished && crawlErrorMessage

  const useDatasourceNodeRun = useRef(!isInPipeline ? usePublishedDatasourceNodeRun : useDraftDatasourceNodeRun)
  const useDatasourceNodeRunStatus = useRef(!isInPipeline ? usePublishedDatasourceNodeRunStatus : useDraftDatasourceNodeRunStatus)
  const { mutateAsync: runDatasourceNode } = useDatasourceNodeRun.current()
  const { mutateAsync: getDatasourceNodeRunStatus } = useDatasourceNodeRunStatus.current()

  const checkCrawlStatus = useCallback(async (jobId: string) => {
    const res = await getDatasourceNodeRunStatus({
      node_id: nodeId,
      pipeline_id: pipelineId!,
      job_id: jobId,
      datasource_type: DatasourceType.websiteCrawl,
    }, {
      onError: async (error: any) => {
        const message = await error.json()
        setCrawlErrorMessage(message || t(`${I18N_PREFIX}.unknownError`))
      },
    }) as any
    if (res.status === 'completed') {
      setCrawlResult(res)
      onCheckedCrawlResultChange(res.result || []) // default select the crawl result
      setCrawlErrorMessage('')
      setStep(Step.finished)
    }
    else if (res.status === 'processing') {
      await sleep(2500)
      await checkCrawlStatus(jobId)
    }
  }, [getDatasourceNodeRunStatus, nodeId, pipelineId, t, onCheckedCrawlResultChange])

  const handleRun = useCallback(async (value: Record<string, any>) => {
    setStep(Step.running)
    const res = await runDatasourceNode({
      node_id: nodeId,
      pipeline_id: pipelineId!,
      inputs: value,
      datasource_type: DatasourceType.websiteCrawl,
    }, {
      onError: async (error: any) => {
        const message = await error.json()
        setCrawlErrorMessage(message || t(`${I18N_PREFIX}.unknownError`))
        setStep(Step.finished)
      },
    }) as any
    const jobId = res.job_id
    if (!jobId && res.status === 'completed') {
      setCrawlResult(res)
      onCheckedCrawlResultChange(res.result || []) // default select the crawl result
      setStep(Step.finished)
    }
    else if (jobId) {
      await checkCrawlStatus(jobId)
    }
    setCrawlErrorMessage('')
  }, [runDatasourceNode, nodeId, pipelineId, onCheckedCrawlResultChange, checkCrawlStatus, t])

  return (
    <div className='flex flex-col'>
      <Header
        isInPipeline
        {...headerInfo}
      />
      <div className='mt-2 rounded-xl border border-components-panel-border bg-background-default-subtle'>
        <Options
          variables={paramsConfig?.variables || []}
          isRunning={isRunning}
          controlFoldOptions={controlFoldOptions}
          onSubmit={(value) => {
            handleRun(value)
          }}
        />
      </div>
      {!isInit && (
        <div className='relative flex flex-col'>
          {isRunning && (
            <Crawling
              crawledNum={0}
              totalNum={0}
            />
          )}
          {showError && (
            <ErrorMessage
              className='mt-2'
              title={t(`${I18N_PREFIX}.exceptionErrorTitle`)}
              errorMsg={crawlErrorMessage}
            />
          )}
          {isCrawlFinished && !showError && (
            <CrawledResult
              className='mt-2'
              list={crawlResult?.result || []}
              checkedList={checkedCrawlResult}
              onSelectedChange={onCheckedCrawlResultChange}
              usedTime={Number.parseFloat(crawlResult?.time_consuming as string) || 0}
              onPreview={onPreview}
            />
          )}
        </div>
      )}
    </div>
  )
}
export default React.memo(Crawler)
