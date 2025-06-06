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
  useDraftPipelinePreProcessingParams,
  usePublishedDatasourceNodeRun,
  usePublishedPipelineProcessingParams,
} from '@/service/use-pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type CrawlerProps = {
  nodeId: string
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onJobIdChange: (jobId: string) => void
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
  onJobIdChange,
  onPreview,
  isInPipeline = false,
}: CrawlerProps) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(Step.init)
  const [controlFoldOptions, setControlFoldOptions] = useState<number>(0)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)

  const usePreProcessingParams = useRef(!isInPipeline ? usePublishedPipelineProcessingParams : useDraftPipelinePreProcessingParams)
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
  const { mutateAsync: runDatasourceNode } = useDatasourceNodeRun.current()

  const handleRun = useCallback(async (value: Record<string, any>) => {
    setStep(Step.running)
    await runDatasourceNode({
      node_id: nodeId,
      pipeline_id: pipelineId!,
      inputs: value,
      datasource_type: DatasourceType.websiteCrawl,
    }, {
      onSuccess: (res: any) => {
        const jobId = res.job_id
        onJobIdChange(jobId)
        setCrawlResult(res)
        onCheckedCrawlResultChange(res.result || []) // default select the crawl result
        setCrawlErrorMessage('')
      },
      onError: (error) => {
        setCrawlErrorMessage(error.message || t(`${I18N_PREFIX}.unknownError`))
      },
      onSettled: () => {
        setStep(Step.finished)
      },
    })
  }, [runDatasourceNode, nodeId, pipelineId, onJobIdChange, onCheckedCrawlResultChange, t])

  return (
    <div>
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
        <div className='relative'>
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
