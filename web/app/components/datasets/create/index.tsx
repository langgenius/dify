'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '../../base/app-unavailable'
import { ModelTypeEnum } from '../../header/account-setting/model-provider-page/declarations'
import StepsNavBar from './steps-nav-bar'
import StepOne from './step-one'
import StepTwo from './step-two'
import StepThree from './step-three'
import { DataSourceType } from '@/models/datasets'
import type { CrawlOptions, CrawlResultItem, DataSet, FileItem, createDocumentResponse } from '@/models/datasets'
import { fetchDataSource } from '@/service/common'
import { fetchDatasetDetail } from '@/service/datasets'
import { DataSourceProvider, type NotionPage } from '@/models/common'
import { useModalContext } from '@/context/modal-context'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'

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
  const { setShowAccountSettingModal } = useModalContext()
  const [hasConnection, setHasConnection] = useState(true)
  const [dataSourceType, setDataSourceType] = useState<DataSourceType>(DataSourceType.FILE)
  const [step, setStep] = useState(1)
  const [indexingTypeCache, setIndexTypeCache] = useState('')
  const [fileList, setFiles] = useState<FileItem[]>([])
  const [result, setResult] = useState<createDocumentResponse | undefined>()
  const [hasError, setHasError] = useState(false)
  const { data: embeddingsDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)

  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const updateNotionPages = (value: NotionPage[]) => {
    setNotionPages(value)
  }

  const [websitePages, setWebsitePages] = useState<CrawlResultItem[]>([])
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>(DEFAULT_CRAWL_OPTIONS)

  const updateFileList = (preparedFiles: FileItem[]) => {
    setFiles(preparedFiles)
  }
  const [websiteCrawlProvider, setWebsiteCrawlProvider] = useState<DataSourceProvider>(DataSourceProvider.fireCrawl)
  const [websiteCrawlJobId, setWebsiteCrawlJobId] = useState('')

  const updateFile = (fileItem: FileItem, progress: number, list: FileItem[]) => {
    const targetIndex = list.findIndex(file => file.fileID === fileItem.fileID)
    list[targetIndex] = {
      ...list[targetIndex],
      progress,
    }
    setFiles([...list])
    // use follow code would cause dirty list update problem
    // const newList = list.map((file) => {
    //   if (file.fileID === fileItem.fileID) {
    //     return {
    //       ...fileItem,
    //       progress,
    //     }
    //   }
    //   return file
    // })
    // setFiles(newList)
  }
  const updateIndexingTypeCache = (type: string) => {
    setIndexTypeCache(type)
  }
  const updateResultCache = (res?: createDocumentResponse) => {
    setResult(res)
  }

  const nextStep = useCallback(() => {
    setStep(step + 1)
  }, [step, setStep])

  const changeStep = useCallback((delta: number) => {
    setStep(step + delta)
  }, [step, setStep])

  const checkNotionConnection = async () => {
    const { data } = await fetchDataSource({ url: '/data-source/integrates' })
    const hasConnection = data.filter(item => item.provider === 'notion') || []
    setHasConnection(hasConnection.length > 0)
  }

  useEffect(() => {
    checkNotionConnection()
  }, [])

  const [detail, setDetail] = useState<DataSet | null>(null)
  useEffect(() => {
    (async () => {
      if (datasetId) {
        try {
          const detail = await fetchDatasetDetail(datasetId)
          setDetail(detail)
        }
        catch (e) {
          setHasError(true)
        }
      }
    })()
  }, [datasetId])

  if (hasError)
    return <AppUnavailable code={500} unknownReason={t('datasetCreation.error.unavailable') as string} />

  return (
    <div className='flex' style={{ height: 'calc(100vh - 56px)' }}>
      <div className="flex flex-col w-11 sm:w-56 overflow-y-auto bg-white border-r border-gray-200 shrink-0">
        <StepsNavBar step={step} datasetId={datasetId} />
      </div>
      <div className="grow bg-white">
        <div className={step === 1 ? 'block h-full' : 'hidden'}>
          <StepOne
            hasConnection={hasConnection}
            onSetting={() => setShowAccountSettingModal({ payload: 'data-source' })}
            datasetId={datasetId}
            dataSourceType={dataSourceType}
            dataSourceTypeDisable={!!detail?.data_source_type}
            changeType={setDataSourceType}
            files={fileList}
            updateFile={updateFile}
            updateFileList={updateFileList}
            notionPages={notionPages}
            updateNotionPages={updateNotionPages}
            onStepChange={nextStep}
            websitePages={websitePages}
            updateWebsitePages={setWebsitePages}
            onWebsiteCrawlProviderChange={setWebsiteCrawlProvider}
            onWebsiteCrawlJobIdChange={setWebsiteCrawlJobId}
            crawlOptions={crawlOptions}
            onCrawlOptionsChange={setCrawlOptions}
          />
        </div>
        {(step === 2 && (!datasetId || (datasetId && !!detail))) && <StepTwo
          isAPIKeySet={!!embeddingsDefaultModel}
          onSetting={() => setShowAccountSettingModal({ payload: 'provider' })}
          indexingType={detail?.indexing_technique}
          datasetId={datasetId}
          dataSourceType={dataSourceType}
          files={fileList.map(file => file.file)}
          notionPages={notionPages}
          websitePages={websitePages}
          websiteCrawlProvider={websiteCrawlProvider}
          websiteCrawlJobId={websiteCrawlJobId}
          onStepChange={changeStep}
          updateIndexingTypeCache={updateIndexingTypeCache}
          updateResultCache={updateResultCache}
          crawlOptions={crawlOptions}
        />}
        {step === 3 && <StepThree
          datasetId={datasetId}
          datasetName={detail?.name}
          indexingType={detail?.indexing_technique || indexingTypeCache}
          creationCache={result}
        />}
      </div>
    </div>
  )
}

export default DatasetUpdateForm
