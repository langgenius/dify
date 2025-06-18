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
  useDraftPipelinePreProcessingParams,
  usePublishedPipelinePreProcessingParams,
} from '@/service/use-pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'
import { ssePost } from '@/service/base'
import type {
  DataSourceNodeCompletedResponse,
  DataSourceNodeProcessingResponse,
} from '@/types/pipeline'

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
  const [totalNum, setTotalNum] = useState(0)
  const [crawledNum, setCrawledNum] = useState(0)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)

  const usePreProcessingParams = useRef(!isInPipeline ? usePublishedPipelinePreProcessingParams : useDraftPipelinePreProcessingParams)
  const { data: paramsConfig, isFetching: isFetchingParams } = usePreProcessingParams.current({
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
    data: CrawlResultItem[]
    time_consuming: number | string
  } | undefined>(undefined)
  const [crawlErrorMessage, setCrawlErrorMessage] = useState('')
  const showError = isCrawlFinished && crawlErrorMessage

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const handleRun = useCallback(async (value: Record<string, any>) => {
    setStep(Step.running)
    ssePost(
      datasourceNodeRunURL,
      {
        body: {
          inputs: value,
          datasource_type: DatasourceType.websiteCrawl,
          response_mode: 'streaming',
        },
      },
      {
        onDataSourceNodeProcessing: (data: DataSourceNodeProcessingResponse) => {
          setTotalNum(data.total ?? 0)
          setCrawledNum(data.completed ?? 0)
        },
        onDataSourceNodeCompleted: (data: DataSourceNodeCompletedResponse) => {
          const { data: crawlData, time_consuming } = data
          setCrawlResult({
            data: crawlData as CrawlResultItem[],
            time_consuming: time_consuming ?? 0,
          })
          onCheckedCrawlResultChange(crawlData || []) // default select the crawl result
          setCrawlErrorMessage('')
          setStep(Step.finished)
        },
        onError: (message: string) => {
          setCrawlErrorMessage(message || t(`${I18N_PREFIX}.unknownError`))
          setStep(Step.finished)
        },
      },
    )
  }, [datasourceNodeRunURL, onCheckedCrawlResultChange, t])

  const handleSubmit = useCallback((value: Record<string, any>) => {
    handleRun(value)
  }, [handleRun])

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
          runDisabled={isFetchingParams}
          controlFoldOptions={controlFoldOptions}
          onSubmit={handleSubmit}
        />
      </div>
      {!isInit && (
        <div className='relative flex flex-col'>
          {isRunning && (
            <Crawling
              crawledNum={crawledNum}
              totalNum={totalNum}
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
              list={crawlResult?.data || []}
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
