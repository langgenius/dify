'use client'
import { useEffect, useState } from 'react'
import type { Dispatch } from 'react'
import { useContext } from 'use-context-selector'
import { BookOpenIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useSWRConfig } from 'swr'
import { unstable_serialize } from 'swr/infinite'
import PermissionsRadio from '../permissions-radio'
import IndexMethodRadio from '../index-method-radio'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import { updateDatasetSetting } from '@/service/datasets'
import type { DataSet, DataSetListResponse } from '@/models/datasets'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import AccountSetting from '@/app/components/header/account-setting'
import DatasetDetailContext from '@/context/dataset-detail'
import RadioCard from '@/app/components/base/radio-card'
import { PatternRecognition, Semantic } from '@/app/components/base/icons/src/vender/solid/development'
import { FileSearch02 } from '@/app/components/base/icons/src/vender/solid/files'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
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

const getKey = (pageIndex: number, previousPageData: DataSetListResponse) => {
  if (!pageIndex || previousPageData.has_more)
    return { url: 'datasets', params: { page: pageIndex + 1, limit: 30 } }
  return null
}

const Form = () => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { mutate } = useSWRConfig()
  const { dataset: currentDataset, mutateDatasetRes: mutateDatasets } = useContext(DatasetDetailContext)
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
      if (mutateDatasets) {
        await mutateDatasets()
        mutate(unstable_serialize(getKey))
      }
    }
    catch (e) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
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
      <div className={rowClass}>
        <div className={labelClass}>
          <div>
            <div>{t('datasetSettings.form.retrievalSetting.title')}</div>
            <div className='leading-[18px] text-xs font-normal text-gray-500'>
              <a href='' className='text-[#155eef]'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
              {t('datasetSettings.form.retrievalSetting.description')}
            </div>
          </div>
        </div>
        <div className='w-[480px]'>
          <div className='space-y-2'>
            <RadioCard
              icon={<Semantic className='w-4 h-4 text-[#7839EE]' />}
              title={'Semantic Search'}
              description='Generate query embeddings and search for the text chunk most similar to its vector representation.'
              isChosen
              onChosen={() => {}}
            />
            <RadioCard
              icon={<FileSearch02 className='w-4 h-4 text-[#7839EE]' />}
              title={'Full-Text Search'}
              description='Generate query embeddings and search for the text chunk most similar to its vector representation.'
              isChosen={false}
              onChosen={() => {}}
            />
            <RadioCard
              icon={<PatternRecognition className='w-4 h-4 text-[#7839EE]' />}
              title={'Hybrid Search'}
              description='Generate query embeddings and search for the text chunk most similar to its vector representation.'
              isChosen={true}
              onChosen={() => {}}
              chosenConfig={
                <div>
                  <div>
                    <div className='leading-[32px] text-[13px] font-medium text-gray-900'>{t('common.modelProvider.rerankModel.key')}</div>
                    <div>Rerank Model 站位</div>
                  </div>
                  <div className='flex mt-4 space-between space-x-6'>
                    <TopKItem
                      className='grow'
                      value={2}
                      onChange={() => {}}
                      enable={true}
                    />
                    <ScoreThresholdItem
                      className='grow'
                      value={1}
                      onChange={() => {}}
                      enable={true}
                      hasSwitch={true}
                      onSwitchChange={() => {}}
                    />
                  </div>
                </div>
              }
            />
          </div>
        </div>
      </div>
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
