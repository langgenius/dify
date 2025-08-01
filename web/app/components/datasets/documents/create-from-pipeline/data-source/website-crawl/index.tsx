'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth'
import { noop } from 'lodash-es'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

export type WebsiteCrawlProps = {
  nodeId: string
  nodeData: DataSourceNodeType
  isInPipeline?: boolean
}

const WebsiteCrawl = ({
  nodeId,
  nodeData,
  isInPipeline = false,
}: WebsiteCrawlProps) => {
  const { t } = useTranslation()
  const [controlFoldOptions, setControlFoldOptions] = useState<number>(0)
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
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    crawlResult: state.crawlResult,
    step: state.step,
    checkedCrawlResult: state.websitePages,
    previewIndex: state.previewIndex,
  })))
  const dataSourceStore = useDataSourceStore()

  const usePreProcessingParams = useRef(!isInPipeline ? usePublishedPipelinePreProcessingParams : useDraftPipelinePreProcessingParams)
  const { data: paramsConfig, isFetching: isFetchingParams } = usePreProcessingParams.current({
    pipeline_id: pipelineId!,
    node_id: nodeId,
  }, !!pipelineId && !!nodeId)

  useEffect(() => {
    if (step !== CrawlStep.init)
      setControlFoldOptions(Date.now())
  }, [step])

  useEffect(() => {
    const {
      setStep,
      setCrawlResult,
      setWebsitePages,
      setPreviewIndex,
      setCurrentWebsite,
      currentNodeIdRef,
    } = dataSourceStore.getState()
    if (nodeId !== currentNodeIdRef.current) {
      setStep(CrawlStep.init)
      setCrawlResult(undefined)
      setCurrentWebsite(undefined)
      setWebsitePages([])
      setPreviewIndex(-1)
      setCrawledNum(0)
      setTotalNum(0)
      setCrawlErrorMessage('')
      currentNodeIdRef.current = nodeId
    }
  }, [nodeId])

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
    const { setStep, setCrawlResult } = dataSourceStore.getState()

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

  return (
    <div className='flex flex-col'>
      <Header
        // todo: delete mock data
        docTitle='How to use?'
        docLink='https://docs.dify.ai'
        onClickConfiguration={handleSetting}
        pluginName={nodeData.datasource_label}
        currentCredentialId={'12345678'}
        onCredentialChange={noop}
        credentials={[{
          avatar_url: 'https://cloud.dify.ai/logo/logo.svg',
          credential: {
            credentials: '......',
          },
          id: '12345678',
          is_default: true,
          name: 'test123',
          type: CredentialTypeEnum.API_KEY,
        }]}
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
