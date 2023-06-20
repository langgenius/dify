'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import AppUnavailable from '../../base/app-unavailable'
import StepsNavBar from './steps-nav-bar'
import StepOne from './step-one'
import StepTwo from './step-two'
import StepThree from './step-three'
import { DataSourceType } from '@/models/datasets'
import type { DataSet, createDocumentResponse } from '@/models/datasets'
import { fetchDataSource, fetchTenantInfo } from '@/service/common'
import { fetchDataDetail } from '@/service/datasets'
import type { DataSourceNotionPage } from '@/models/common'

import AccountSetting from '@/app/components/header/account-setting'

type Page = DataSourceNotionPage & { workspace_id: string }

type DatasetUpdateFormProps = {
  datasetId?: string
}

const DatasetUpdateForm = ({ datasetId }: DatasetUpdateFormProps) => {
  const { t } = useTranslation()
  const [hasSetAPIKEY, setHasSetAPIKEY] = useState(true)
  const [isShowSetAPIKey, { setTrue: showSetAPIKey, setFalse: hideSetAPIkey }] = useBoolean()
  const [hasConnection, setHasConnection] = useState(true)
  const [isShowDataSourceSetting, { setTrue: showDataSourceSetting, setFalse: hideDataSourceSetting }] = useBoolean()
  const [dataSourceType, setDataSourceType] = useState<DataSourceType>(DataSourceType.FILE)
  const [step, setStep] = useState(1)
  const [indexingTypeCache, setIndexTypeCache] = useState('')
  const [fileList, setFiles] = useState<any[]>([])
  const [result, setResult] = useState<createDocumentResponse | undefined>()
  const [hasError, setHasError] = useState(false)

  const [notionPages, setNotionPages] = useState<Page[]>([])
  const updateNotionPages = (value: Page[]) => {
    setNotionPages(value)
  }

  const updateFileList = (preparedFiles: any) => {
    setFiles(preparedFiles)
  }

  const updateFile = (fileItem: any, progress: number, list: any[]) => {
    const targetIndex = list.findIndex((file: any) => file.fileID === fileItem.fileID)
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

  const checkAPIKey = async () => {
    const data = await fetchTenantInfo({ url: '/info' })
    const hasSetKey = data.providers.some(({ is_valid }) => is_valid)
    setHasSetAPIKEY(hasSetKey)
  }
  const checkNotionConnection = async () => {
    const { data } = await fetchDataSource({ url: '/data-source/integrates' })
    const hasConnection = data.filter(item => item.provider === 'notion') || []
    setHasConnection(hasConnection.length > 0)
  }

  useEffect(() => {
    checkAPIKey()
    checkNotionConnection()
  }, [])

  const [detail, setDetail] = useState<DataSet | null>(null)
  useEffect(() => {
    (async () => {
      if (datasetId) {
        try {
          const detail = await fetchDataDetail(datasetId)
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
      <div className="flex flex-col w-56 overflow-y-auto bg-white border-r border-gray-200 shrink-0">
        <StepsNavBar step={step} datasetId={datasetId} />
      </div>
      <div className="grow bg-white">
        {step === 1 && <StepOne
          hasConnection={hasConnection}
          onSetting={showDataSourceSetting}
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
        />}
        {(step === 2 && (!datasetId || (datasetId && !!detail))) && <StepTwo
          hasSetAPIKEY={hasSetAPIKEY}
          onSetting={showSetAPIKey}
          indexingType={detail?.indexing_technique || ''}
          datasetId={datasetId}
          dataSourceType={dataSourceType}
          files={fileList.map(file => file.file)}
          notionPages={notionPages}
          onStepChange={changeStep}
          updateIndexingTypeCache={updateIndexingTypeCache}
          updateResultCache={updateResultCache}
        />}
        {step === 3 && <StepThree
          datasetId={datasetId}
          datasetName={detail?.name}
          indexingType={detail?.indexing_technique || indexingTypeCache}
          creationCache={result}
        />}
      </div>
      {isShowSetAPIKey && <AccountSetting activeTab="provider" onCancel={async () => {
        await checkAPIKey()
        hideSetAPIkey()
      }} />}
      {isShowDataSourceSetting && <AccountSetting activeTab="data-source" onCancel={hideDataSourceSetting}/>}
    </div>
  )
}

export default DatasetUpdateForm
