'use client'
import { useEffect, useState } from 'react'
import type { Dispatch } from 'react'
import useSWR from 'swr'
import { useContext } from 'use-context-selector'
import { BookOpenIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import PermissionsRadio from '../permissions-radio'
import IndexMethodRadio from '../index-method-radio'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import { fetchDataDetail, updateDatasetSetting } from '@/service/datasets'
import type { DataSet } from '@/models/datasets'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import AccountSetting from '@/app/components/header/account-setting'

const rowClass = `
  flex justify-between py-4
`
const labelClass = `
  flex items-center w-[168px] h-9
`
const inputClass = `
  w-[480px] px-3 bg-gray-100 text-sm text-gray-800 rounded-lg outline-none appearance-none
`
const useInitialValue: <T>(depend: T, dispatch: Dispatch<T>) => void = (depend, dispatch) => {
  useEffect(() => {
    dispatch(depend)
  }, [depend])
}

type Props = {
  datasetId: string
}

const Form = ({
  datasetId,
}: Props) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { data: currentDataset, mutate: mutateDatasets } = useSWR(datasetId, fetchDataDetail)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(currentDataset?.name ?? '')
  const [description, setDescription] = useState(currentDataset?.description ?? '')
  const [permission, setPermission] = useState(currentDataset?.permission)
  const [indexMethod, setIndexMethod] = useState(currentDataset?.indexing_technique)
  const [showSetAPIKeyModal, setShowSetAPIKeyModal] = useState(false)
  const handleSave = async () => {
    if (loading)
      return
    if (!name?.trim()) {
      notify({ type: 'error', message: t('datasetSettings.form.nameError') })
      return
    }
    try {
      setLoading(true)
      await updateDatasetSetting({
        datasetId: currentDataset!.id,
        body: {
          name,
          description,
          permission,
          indexing_technique: indexMethod,
        },
      })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      await mutateDatasets()
    }
    catch (e) {
      notify({ type: 'error', message: t('common.actionMsg.modificationFailed') })
    }
    finally {
      setLoading(false)
    }
  }

  useInitialValue<string>(currentDataset?.name ?? '', setName)
  useInitialValue<string>(currentDataset?.description ?? '', setDescription)
  useInitialValue<DataSet['permission'] | undefined>(currentDataset?.permission, setPermission)
  useInitialValue<DataSet['indexing_technique'] | undefined>(currentDataset?.indexing_technique, setIndexMethod)

  return (
    <div className='w-[800px] px-16 py-6'>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.name')}</div>
        </div>
        <input
          disabled={!currentDataset?.embedding_available}
          className={cn(inputClass, !currentDataset?.embedding_available && 'opacity-60')}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.desc')}</div>
        </div>
        <div>
          <textarea
            disabled={!currentDataset?.embedding_available}
            className={cn(`${inputClass} block mb-2 h-[120px] py-2 resize-none`, !currentDataset?.embedding_available && 'opacity-60')}
            placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <a className='flex items-center h-[18px] px-3 text-xs text-gray-500' href="https://docs.dify.ai/advanced/datasets#how-to-write-a-good-dataset-description" target='_blank'>
            <BookOpenIcon className='w-3 h-[18px] mr-1' />
            {t('datasetSettings.form.descWrite')}
          </a>
        </div>
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.permissions')}</div>
        </div>
        <div className='w-[480px]'>
          <PermissionsRadio
            disable={!currentDataset?.embedding_available}
            value={permission}
            onChange={v => setPermission(v)}
          />
        </div>
      </div>
      {currentDataset && currentDataset.indexing_technique && (
        <>
          <div className='w-full h-0 border-b-[0.5px] border-b-gray-200 my-2' />
          <div className={rowClass}>
            <div className={labelClass}>
              <div>{t('datasetSettings.form.indexMethod')}</div>
            </div>
            <div className='w-[480px]'>
              <IndexMethodRadio
                disable={!currentDataset?.embedding_available}
                value={indexMethod}
                onChange={v => setIndexMethod(v)}
              />
            </div>
          </div>
        </>
      )}
      {currentDataset && currentDataset.indexing_technique === 'high_quality' && (
        <div className={rowClass}>
          <div className={labelClass}>
            <div>{t('datasetSettings.form.embeddingModel')}</div>
          </div>
          <div className='w-[480px]'>
            <div className='w-full h-9 rounded-lg bg-gray-100 opacity-60'>
              <ModelSelector
                readonly
                value={{
                  providerName: currentDataset.embedding_model_provider as ProviderEnum,
                  modelName: currentDataset.embedding_model,
                }}
                modelType={ModelType.embeddings}
                onChange={() => {}}
              />
            </div>
            <div className='mt-2 w-full text-xs leading-6 text-gray-500'>
              {t('datasetSettings.form.embeddingModelTip')}
              <span className='text-[#155eef] cursor-pointer' onClick={() => setShowSetAPIKeyModal(true)}>{t('datasetSettings.form.embeddingModelTipLink')}</span>
            </div>
          </div>
        </div>
      )}
      {currentDataset?.embedding_available && (
        <div className={rowClass}>
          <div className={labelClass} />
          <div className='w-[480px]'>
            <Button
              className='min-w-24 text-sm'
              type='primary'
              onClick={handleSave}
            >
              {t('datasetSettings.form.save')}
            </Button>
          </div>
        </div>
      )}
      {showSetAPIKeyModal && (
        <AccountSetting activeTab="provider" onCancel={async () => {
          setShowSetAPIKeyModal(false)
        }} />
      )}
    </div>
  )
}

export default Form
