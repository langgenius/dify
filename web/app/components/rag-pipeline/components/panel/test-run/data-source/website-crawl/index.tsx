'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CrawlResult, CrawlResultItem } from '@/models/datasets'
import { CrawlStep } from '@/models/datasets'
import Header from '@/app/components/datasets/create/website/base/header'
import Options from './base/options'
import Crawling from './base/crawling'
import ErrorMessage from './base/error-message'
import CrawledResult from './base/crawled-result'
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
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

export type WebsiteCrawlProps = {
  nodeId: string
  nodeData: DataSourceNodeType
  crawlResult: CrawlResult | undefined
  setCrawlResult: (payload: CrawlResult) => void
  step: CrawlStep
  setStep: (step: CrawlStep) => void
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  previewIndex?: number
  onPreview?: (payload: CrawlResultItem, index: number) => void
  isInPipeline?: boolean
}

const WebsiteCrawl = ({
  nodeId,
  nodeData,
  crawlResult,
  setCrawlResult,
  step,
  setStep,
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  previewIndex,
  onPreview,
  isInPipeline = false,
}: WebsiteCrawlProps) => {
  const { t } = useTranslation()
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
    if (step !== CrawlStep.init)
      setControlFoldOptions(Date.now())
  }, [step])

  const isInit = step === CrawlStep.init
  const isCrawlFinished = step === CrawlStep.finished
  const isRunning = step === CrawlStep.running
  const [crawlErrorMessage, setCrawlErrorMessage] = useState('')
  const showError = isCrawlFinished && crawlErrorMessage

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const handleRun = useCallback(async (value: Record<string, any>) => {
    setStep(CrawlStep.running)
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
          const crawlResultData = {
            data: crawlData.map((item: any) => {
              const { content, ...rest } = item
              return {
                markdown: content || '',
                ...rest,
              } as CrawlResultItem
            }),
            time_consuming: time_consuming ?? 0,
          }
          setCrawlResult(crawlResultData)
          onCheckedCrawlResultChange(crawlData || []) // default select the crawl result
          setCrawlErrorMessage('')
          setStep(CrawlStep.finished)
        },
        onError: (message: string) => {
          setCrawlErrorMessage(message || t(`${I18N_PREFIX}.unknownError`))
          setStep(CrawlStep.finished)
        },
      },
    )
  }, [datasourceNodeRunURL, onCheckedCrawlResultChange, setCrawlResult, setStep, t])

  const handleSubmit = useCallback((value: Record<string, any>) => {
    handleRun(value)
  }, [handleRun])

  const headerInfo = useMemo(() => {
    return {
      title: nodeData.title,
      docTitle: 'How to use?',
      docLink: 'https://docs.dify.ai',
    }
  }, [nodeData])

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
              previewIndex={previewIndex}
              onPreview={onPreview}
              isMultipleChoice={false} // only support single choice in test run
            />
          )}
        </div>
      )}
    </div>
  )
}
export default React.memo(WebsiteCrawl)
