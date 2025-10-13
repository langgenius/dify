'use client'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CrawlResultItem } from '@/models/datasets'
import { CrawlStep } from '@/models/datasets'
import Header from '../base/header'
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
  DataSourceNodeErrorResponse,
  DataSourceNodeProcessingResponse,
} from '@/types/pipeline'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../store'
import { useShallow } from 'zustand/react/shallow'
import { useModalContextSelector } from '@/context/modal-context'
import { useGetDataSourceAuth } from '@/service/use-datasource'
import { useDocLink } from '@/context/i18n'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

export type WebsiteCrawlProps = {
  nodeId: string
  nodeData: DataSourceNodeType
  isInPipeline?: boolean
  onCredentialChange: (credentialId: string) => void
}

const WebsiteCrawl = ({
  nodeId,
  nodeData,
  isInPipeline = false,
  onCredentialChange,
}: WebsiteCrawlProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const [totalNum, setTotalNum] = useState(0)
  const [crawledNum, setCrawledNum] = useState(0)
  const [crawlErrorMessage, setCrawlErrorMessage] = useState('')
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const {
    crawlResult,
    step,
    checkedCrawlResult,
    previewIndex,
    currentCredentialId,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    crawlResult: state.crawlResult,
    step: state.step,
    checkedCrawlResult: state.websitePages,
    previewIndex: state.previewIndex,
    currentCredentialId: state.currentCredentialId,
  })))

  const { data: dataSourceAuth } = useGetDataSourceAuth({
    pluginId: nodeData.plugin_id,
    provider: nodeData.provider_name,
  })

  const dataSourceStore = useDataSourceStore()

  const usePreProcessingParams = useRef(!isInPipeline ? usePublishedPipelinePreProcessingParams : useDraftPipelinePreProcessingParams)
  const { data: paramsConfig, isFetching: isFetchingParams } = usePreProcessingParams.current({
    pipeline_id: pipelineId!,
    node_id: nodeId,
  }, !!pipelineId && !!nodeId)

  const isInit = step === CrawlStep.init
  const isCrawlFinished = step === CrawlStep.finished
  const isRunning = step === CrawlStep.running
  const showError = isCrawlFinished && crawlErrorMessage
  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const handleCheckedCrawlResultChange = useCallback((checkedCrawlResult: CrawlResultItem[]) => {
    const { setWebsitePages } = dataSourceStore.getState()
    setWebsitePages(checkedCrawlResult)
  }, [dataSourceStore])

  const handlePreview = useCallback((website: CrawlResultItem, index: number) => {
    const { setCurrentWebsite, setPreviewIndex } = dataSourceStore.getState()
    setCurrentWebsite(website)
    setPreviewIndex(index)
  }, [dataSourceStore])

  const handleRun = useCallback(async (value: Record<string, any>) => {
    const { setStep, setCrawlResult, currentCredentialId } = dataSourceStore.getState()

    setStep(CrawlStep.running)
    ssePost(
      datasourceNodeRunURL,
      {
        body: {
          inputs: value,
          datasource_type: DatasourceType.websiteCrawl,
          credential_id: currentCredentialId,
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
            data: crawlData as CrawlResultItem[],
            time_consuming: time_consuming ?? 0,
          }
          setCrawlResult(crawlResultData)
          handleCheckedCrawlResultChange(isInPipeline ? [crawlData[0]] : crawlData) // default select the crawl result
          setCrawlErrorMessage('')
          setStep(CrawlStep.finished)
        },
        onDataSourceNodeError: (error: DataSourceNodeErrorResponse) => {
          setCrawlErrorMessage(error.error || t(`${I18N_PREFIX}.unknownError`))
          setStep(CrawlStep.finished)
        },
      },
    )
  }, [dataSourceStore, datasourceNodeRunURL, handleCheckedCrawlResultChange, isInPipeline, t])

  const handleSubmit = useCallback((value: Record<string, any>) => {
    handleRun(value)
  }, [handleRun])

  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  const handleCredentialChange = useCallback((credentialId: string) => {
    setCrawledNum(0)
    setTotalNum(0)
    setCrawlErrorMessage('')
    onCredentialChange(credentialId)
  }, [dataSourceStore, onCredentialChange])

  return (
    <div className='flex flex-col'>
      <Header
        docTitle='Docs'
        docLink={docLink('/guides/knowledge-base/knowledge-pipeline/authorize-data-source')}
        onClickConfiguration={handleSetting}
        pluginName={nodeData.datasource_label}
        currentCredentialId={currentCredentialId}
        onCredentialChange={handleCredentialChange}
        credentials={dataSourceAuth?.result || []}
      />
      <div className='mt-2 rounded-xl border border-components-panel-border bg-background-default-subtle'>
        <Options
          variables={paramsConfig?.variables || []}
          step={step}
          runDisabled={!currentCredentialId || isFetchingParams}
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
              onSelectedChange={handleCheckedCrawlResultChange}
              usedTime={Number.parseFloat(crawlResult?.time_consuming as string) || 0}
              previewIndex={previewIndex}
              onPreview={handlePreview}
              showPreview={!isInPipeline}
              isMultipleChoice={!isInPipeline} // only support single choice in test run
            />
          )}
        </div>
      )}
    </div>
  )
}
export default React.memo(WebsiteCrawl)
