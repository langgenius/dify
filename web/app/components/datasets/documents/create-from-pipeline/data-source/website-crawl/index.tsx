'use client'
import type { DatasourceNodeRunPayload } from '@dify/contracts/api/console/rag/types.gen'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { CrawlResultItem } from '@/models/datasets'
import type {
  DataSourceNodeCompletedResponse,
  DataSourceNodeErrorResponse,
  DataSourceNodeProcessingResponse,
} from '@/types/pipeline'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { selectPipelineStepParameters } from '@/app/components/rag-pipeline/utils/query-select'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDocLink } from '@/context/i18n'
import { CrawlStep } from '@/models/datasets'
import { DatasourceType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import Header from '../base/header'
import { runDatasourceNode } from '../run-datasource-node'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../store'
import CrawledResult from './base/crawled-result'
import Crawling from './base/crawling'
import ErrorMessage from './base/error-message'
import Options from './base/options'

const I18N_PREFIX = 'stepOne.website'

type WebsiteCrawlProps = {
  nodeId: string
  nodeData: DataSourceNodeType
  onCredentialChange: (credentialId: string) => void
  isInPipeline?: boolean
  supportBatchUpload?: boolean
}

const WebsiteCrawl = ({
  nodeId,
  nodeData,
  isInPipeline = false,
  supportBatchUpload = true,
  onCredentialChange,
}: WebsiteCrawlProps) => {
  const { t: tLoad } = useTranslation(['common', 'dataset'])
  const { t } = useTranslation(['datasetCreation'])
  const docLink = useDocLink()
  const [totalNum, setTotalNum] = useState(0)
  const [crawledNum, setCrawledNum] = useState(0)
  const [crawlErrorMessage, setCrawlErrorMessage] = useState('')
  const pipelineId = useDatasetDetailContextWithSelector((s) => s.dataset?.pipeline_id)
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const { crawlResult, step, checkedCrawlResult, previewIndex, currentCredentialId } =
    useDataSourceStoreWithSelector(
      useShallow((state) => ({
        crawlResult: state.crawlResult,
        step: state.step,
        checkedCrawlResult: state.websitePages,
        previewIndex: state.previewIndex,
        currentCredentialId: state.currentCredentialId,
      })),
    )

  const dataSourceAuthQuery = useQuery(
    consoleQuery.auth.plugin.datasource.byProviderId.get.queryOptions({
      input: { params: { provider_id: `${nodeData.plugin_id}/${nodeData.provider_name}` } },
    }),
  )
  const dataSourceAuth = dataSourceAuthQuery.data
  // Without the credentials the source looks unauthorized, so a failed load is shown instead.
  const credentialsLoad = useOwnedQueryError(dataSourceAuthQuery)
  const credentialsLoadErrorMessage = useRequestErrorMessage(
    credentialsLoad?.error,
    tLoad(($) => $.loadError, { ns: 'dataset' }),
  )

  const dataSourceStore = useDataSourceStore()

  const preProcessingParamsInput =
    pipelineId && nodeId
      ? { params: { pipeline_id: pipelineId }, query: { node_id: nodeId } }
      : skipToken
  const workflows = consoleQuery.rag.pipelines.byPipelineId.workflows
  const paramsConfigQuery = useQuery(
    isInPipeline
      ? workflows.draft.preProcessing.parameters.get.queryOptions({
          input: preProcessingParamsInput,
          select: selectPipelineStepParameters,
        })
      : workflows.published.preProcessing.parameters.get.queryOptions({
          input: preProcessingParamsInput,
          select: selectPipelineStepParameters,
        }),
  )
  const { data: paramsConfig, isFetching: isFetchingParams } = paramsConfigQuery
  // Without its parameters the crawl would run with an empty form.
  const paramsLoad = useOwnedQueryError(paramsConfigQuery)
  const paramsLoadErrorMessage = useRequestErrorMessage(
    paramsLoad?.error,
    tLoad(($) => $.loadError, { ns: 'dataset' }),
  )

  const isInit = step === CrawlStep.init
  const isCrawlFinished = step === CrawlStep.finished
  const isRunning = step === CrawlStep.running
  const showError = isCrawlFinished && crawlErrorMessage
  const handleCheckedCrawlResultChange = useCallback(
    (checkedCrawlResult: CrawlResultItem[]) => {
      const { setWebsitePages } = dataSourceStore.getState()
      setWebsitePages(checkedCrawlResult)
    },
    [dataSourceStore],
  )

  const handlePreview = useCallback(
    (website: CrawlResultItem, index: number) => {
      const { setCurrentWebsite, setPreviewIndex } = dataSourceStore.getState()
      setCurrentWebsite(website)
      setPreviewIndex(index)
    },
    [dataSourceStore],
  )

  const handleRun = useCallback(
    async (value: Record<string, any>) => {
      const { setStep, setCrawlResult, currentCredentialId } = dataSourceStore.getState()

      setStep(CrawlStep.running)
      runDatasourceNode(
        { pipelineId, nodeId, isInPipeline },
        // The crawl run also asks for a streaming response, which the payload type does not declare.
        {
          inputs: value,
          datasource_type: DatasourceType.websiteCrawl,
          credential_id: currentCredentialId,
          response_mode: 'streaming',
        } as DatasourceNodeRunPayload,
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
            handleCheckedCrawlResultChange(supportBatchUpload ? crawlData : crawlData.slice(0, 1)) // default select the crawl result
            setCrawlErrorMessage('')
            setStep(CrawlStep.finished)
          },
          onDataSourceNodeError: (error: DataSourceNodeErrorResponse) => {
            setCrawlErrorMessage(
              error.error || t(($) => $[`${I18N_PREFIX}.unknownError`], { ns: 'datasetCreation' }),
            )
            setStep(CrawlStep.finished)
          },
        },
      )
    },
    [
      dataSourceStore,
      pipelineId,
      nodeId,
      isInPipeline,
      handleCheckedCrawlResultChange,
      supportBatchUpload,
      t,
    ],
  )

  const handleSubmit = useCallback(
    (value: Record<string, any>) => {
      handleRun(value)
    },
    [handleRun],
  )

  const handleSetting = useCallback(() => {
    setSettingsDestination('data-source')
  }, [setSettingsDestination])

  const handleCredentialChange = useCallback(
    (credentialId: string) => {
      setCrawledNum(0)
      setTotalNum(0)
      setCrawlErrorMessage('')
      onCredentialChange(credentialId)
    },
    [onCredentialChange],
  )

  return (
    <div className="flex flex-col">
      <Header
        docTitle="Docs"
        docLink={docLink('/use-dify/knowledge/knowledge-pipeline/authorize-data-source')}
        onClickConfiguration={handleSetting}
        pluginName={nodeData.datasource_label}
        currentCredentialId={currentCredentialId}
        onCredentialChange={handleCredentialChange}
        credentials={dataSourceAuth?.result || []}
      />
      {credentialsLoad && (
        <Alert type="error" className="mt-2">
          <AlertTitle>{credentialsLoadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button size="small" loading={credentialsLoad.retrying} onClick={credentialsLoad.retry}>
              {tLoad(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      )}
      {paramsLoad && (
        <Alert type="error" className="mt-2">
          <AlertTitle>{paramsLoadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button size="small" loading={paramsLoad.retrying} onClick={paramsLoad.retry}>
              {tLoad(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      )}
      <div className="mt-2 rounded-xl border border-components-panel-border bg-background-default-subtle">
        <Options
          variables={paramsConfig?.variables || []}
          step={step}
          runDisabled={!currentCredentialId || isFetchingParams || !!paramsLoad}
          onSubmit={handleSubmit}
        />
      </div>
      {!isInit && (
        <div className="relative flex flex-col">
          {isRunning && <Crawling crawledNum={crawledNum} totalNum={totalNum} />}
          {showError && (
            <ErrorMessage
              className="mt-2"
              title={t(($) => $[`${I18N_PREFIX}.exceptionErrorTitle`], { ns: 'datasetCreation' })}
              errorMsg={crawlErrorMessage}
            />
          )}
          {isCrawlFinished && !showError && (
            <CrawledResult
              className="mt-2"
              list={crawlResult?.data || []}
              checkedList={checkedCrawlResult}
              onSelectedChange={handleCheckedCrawlResultChange}
              usedTime={Number.parseFloat(crawlResult?.time_consuming as string) || 0}
              previewIndex={previewIndex}
              onPreview={handlePreview}
              showPreview={!isInPipeline}
              isMultipleChoice={supportBatchUpload} // only support single choice in test run
            />
          )}
        </div>
      )}
    </div>
  )
}
export default React.memo(WebsiteCrawl)
