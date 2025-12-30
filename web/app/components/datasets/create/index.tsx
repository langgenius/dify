'use client'
import type { NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, createDocumentResponse, FileItem } from '@/models/datasets'
import type { RETRIEVE_METHOD } from '@/types/app'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useModalContextSelector } from '@/context/modal-context'
import { DataSourceProvider } from '@/models/common'
import { DataSourceType } from '@/models/datasets'
import { useGetDefaultDataSourceListAuth } from '@/service/use-datasource'
import AppUnavailable from '../../base/app-unavailable'
import { ModelTypeEnum } from '../../header/account-setting/model-provider-page/declarations'
import StepOne from './step-one'
import StepThree from './step-three'
import StepTwo from './step-two'
import { TopBar } from './top-bar'

type DatasetUpdateFormProps = {
  datasetId?: string
}

const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  crawl_sub_pages: true,
  only_main_content: true,
  includes: '',
  excludes: '',
  limit: 10,
  max_depth: '',
  use_sitemap: true,
}

const DatasetUpdateForm = ({ datasetId }: DatasetUpdateFormProps) => {
  const { t } = useTranslation()
  const setShowAccountSettingModal = useModalContextSelector(state => state.setShowAccountSettingModal)
  const datasetDetail = useDatasetDetailContextWithSelector(state => state.dataset)
  const { data: embeddingsDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)

  const [dataSourceType, setDataSourceType] = useState<DataSourceType>(DataSourceType.FILE)
  const [step, setStep] = useState(1)
  const [indexingTypeCache, setIndexTypeCache] = useState('')
  const [retrievalMethodCache, setRetrievalMethodCache] = useState<RETRIEVE_METHOD | ''>('')
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [result, setResult] = useState<createDocumentResponse | undefined>()
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [notionCredentialId, setNotionCredentialId] = useState<string>('')
  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>(DEFAULT_CRAWL_OPTIONS)
  const [websiteCrawlProvider, setWebsiteCrawlProvider] = useState<DataSourceProvider>(DataSourceProvider.jinaReader)
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')

  const {
    data: dataSourceList,
    isLoading: isLoadingAuthedDataSourceList,
    isError: fetchingAuthedDataSourceListError,
  } = useGetDefaultDataSourceListAuth()

  const updateNotionPages = useCallback((value: NotionPage[]) => {
    setNotionPages(value)
  }, [])

  const updateNotionCredentialId = useCallback((credentialId: string) => {
    setNotionCredentialId(credentialId)
  }, [])

  const updateFileList = useCallback((preparedFiles: FileItem[]) => {
    setFiles(preparedFiles)
  }, [])

  const updateFile = useCallback((fileItem: FileItem, progress: number, list: FileItem[]) => {
    const targetIndex = list.findIndex(file => file.fileID === fileItem.fileID)
    const newList = produce(list, (draft) => {
      draft[targetIndex] = {
        ...draft[targetIndex],
        progress,
      }
    })
    setFiles(newList)
  }, [])

  const updateIndexingTypeCache = useCallback((type: string) => {
    setIndexTypeCache(type)
  }, [])

  const updateResultCache = useCallback((res?: createDocumentResponse) => {
    setResult(res)
  }, [])

  const updateRetrievalMethodCache = useCallback((method: RETRIEVE_METHOD | '') => {
    setRetrievalMethodCache(method)
  }, [])

  const nextStep = useCallback(() => {
    setStep(step + 1)
  }, [step, setStep])

  const changeStep = useCallback((delta: number) => {
    setStep(step + delta)
  }, [step, setStep])

  if (fetchingAuthedDataSourceListError)
    return <AppUnavailable code={500} unknownReason={t('error.unavailable', { ns: 'datasetCreation' }) as string} />

  return (
    <div className="flex flex-col overflow-hidden bg-components-panel-bg" style={{ height: 'calc(100vh - 56px)' }}>
      <TopBar activeIndex={step - 1} datasetId={datasetId} />
      <div style={{ height: 'calc(100% - 52px)' }}>
        {
          isLoadingAuthedDataSourceList && (
            <Loading type="app" />
          )
        }
        {
          !isLoadingAuthedDataSourceList && (
            <>
              {step === 1 && (
                <StepOne
                  authedDataSourceList={dataSourceList?.result || []}
                  onSetting={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.DATA_SOURCE })}
                  datasetId={datasetId}
                  dataSourceType={dataSourceType}
                  dataSourceTypeDisable={!!datasetDetail?.data_source_type}
                  changeType={setDataSourceType}
                  files={fileList}
                  updateFile={updateFile}
                  updateFileList={updateFileList}
                  notionPages={notionPages}
                  notionCredentialId={notionCredentialId}
                  updateNotionPages={updateNotionPages}
                  updateNotionCredentialId={updateNotionCredentialId}
                  onStepChange={nextStep}
                  websitePages={websitePages}
                  updateWebsitePages={setWebsitePages}
                  onWebsiteCrawlProviderChange={setWebsiteCrawlProvider}
                  onWebsiteCrawlJobIdChange={setWebsiteCrawlJobId}
                  crawlOptions={crawlOptions}
                  onCrawlOptionsChange={setCrawlOptions}
                />
              )}
              {(step === 2 && (!datasetId || (datasetId && !!datasetDetail))) && (
                <StepTwo
                  isAPIKeySet={!!embeddingsDefaultModel}
                  onSetting={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })}
                  indexingType={datasetDetail?.indexing_technique}
                  datasetId={datasetId}
                  dataSourceType={dataSourceType}
                  files={fileList.map(file => file.file)}
                  notionPages={notionPages}
                  notionCredentialId={notionCredentialId}
                  websitePages={websitePages}
                  websiteCrawlProvider={websiteCrawlProvider}
                  websiteCrawlJobId={websiteCrawlJobId}
                  onStepChange={changeStep}
                  updateIndexingTypeCache={updateIndexingTypeCache}
                  updateRetrievalMethodCache={updateRetrievalMethodCache}
                  updateResultCache={updateResultCache}
                  crawlOptions={crawlOptions}
                />
              )}
              {step === 3 && (
                <StepThree
                  datasetId={datasetId}
                  datasetName={datasetDetail?.name}
                  indexingType={datasetDetail?.indexing_technique || indexingTypeCache}
                  retrievalMethod={datasetDetail?.retrieval_model_dict?.search_method || retrievalMethodCache || undefined}
                  creationCache={result}
                />
              )}
            </>
          )
        }
      </div>
    </div>
  )
}

export default DatasetUpdateForm
