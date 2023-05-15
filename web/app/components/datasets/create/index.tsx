'use client'
import React, { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import type { DataSet, File, createDocumentResponse } from '@/models/datasets'
import { fetchTenantInfo } from '@/service/common'
import { fetchDataDetail } from '@/service/datasets'

import StepsNavBar from './steps-nav-bar'
import StepOne from './step-one'
import StepTwo from './step-two'
import StepThree from './step-three'
import AccountSetting from '@/app/components/header/account-setting'
import AppUnavailable from '../../base/app-unavailable'

type DatasetUpdateFormProps = {
  datasetId?: string;
}

const DatasetUpdateForm = ({ datasetId }: DatasetUpdateFormProps) => {
  const { t } = useTranslation()
  const [hasSetAPIKEY, setHasSetAPIKEY] = useState(true)
  const [isShowSetAPIKey, { setTrue: showSetAPIKey, setFalse: hideSetAPIkey }] = useBoolean()
  const [step, setStep] = useState(1)
  const [indexingTypeCache, setIndexTypeCache] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [result, setResult] = useState<createDocumentResponse | undefined>()
  const [hasError, setHasError] = useState(false)

  const updateFile = (file?: File) => {
    setFile(file)
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

  useEffect(() => {
    checkAPIKey()
  }, [])

  const [detail, setDetail] = useState<DataSet | null>(null)
  useEffect(() => {
    (async () => {
      if (datasetId) {
        try {
          const detail = await fetchDataDetail(datasetId)
          setDetail(detail)
        } catch (e) {
          setHasError(true)
        }
      }
    })()
  }, [datasetId])

  if (hasError) {
    return <AppUnavailable code={500} unknownReason={t('datasetCreation.error.unavailable') as string} />
  }

  return (
    <div className='flex' style={{ height: 'calc(100vh - 56px)' }}>
      <div className="flex flex-col w-56 overflow-y-auto bg-white border-r border-gray-200 shrink-0">
        <StepsNavBar step={step} datasetId={datasetId} />
      </div>
      <div className="grow bg-white">
        {step === 1 && <StepOne
          datasetId={datasetId}
          file={file}
          updateFile={updateFile}
          onStepChange={nextStep}
        />}
        {(step === 2 && (!datasetId || (datasetId && !!detail))) && <StepTwo
          hasSetAPIKEY={hasSetAPIKEY}
          onSetting={showSetAPIKey}
          indexingType={detail?.indexing_technique || ''}
          datasetId={datasetId}
          file={file}
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
    </div>
  )
}

export default DatasetUpdateForm
