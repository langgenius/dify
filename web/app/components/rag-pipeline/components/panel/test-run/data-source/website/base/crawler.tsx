'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CrawlResultItem } from '@/models/datasets'
import Header from '@/app/components/datasets/create/website/base/header'
import Options from '../base/options'
import Crawling from '../base/crawling'
import ErrorMessage from '../base/error-message'
import CrawledResult from '../base/crawled-result'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { useDatasourceNodeRun } from '@/service/use-pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useWebCrawlerHeaderInfo } from '../../../hooks'
import type { DataSourceProvider } from '@/models/common'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type CrawlerProps = {
  nodeId: string
  variables: RAGPipelineVariables
  checkedCrawlResult: CrawlResultItem[]
  datasourceProvider: DataSourceProvider
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onJobIdChange: (jobId: string) => void
}

enum Step {
  init = 'init',
  running = 'running',
  finished = 'finished',
}

const Crawler = ({
  nodeId,
  variables,
  checkedCrawlResult,
  datasourceProvider,
  onCheckedCrawlResultChange,
  onJobIdChange,
}: CrawlerProps) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(Step.init)
  const [controlFoldOptions, setControlFoldOptions] = useState<number>(0)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)

  const headerInfoMap = useWebCrawlerHeaderInfo()

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

  const { mutateAsync: runDatasourceNode } = useDatasourceNodeRun()

  const handleRun = useCallback(async (value: Record<string, any>) => {
    setStep(Step.running)
    await runDatasourceNode({
      node_id: nodeId,
      pipeline_id: pipelineId!,
      inputs: value,
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
        {...headerInfoMap[datasourceProvider]}
      />
      <div className='mt-2 rounded-xl border border-components-panel-border bg-background-default-subtle'>
        <Options
          variables={variables}
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
            />
          )}
        </div>
      )}
    </div>
  )
}
export default React.memo(Crawler)
