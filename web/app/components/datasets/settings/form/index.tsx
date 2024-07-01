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
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import { updateDatasetSetting } from '@/service/datasets'
import type { DataSet, DataSetListResponse } from '@/models/datasets'
import DatasetDetailContext from '@/context/dataset-detail'
import { type RetrievalConfig } from '@/types/app'
import { useModalContext } from '@/context/modal-context'
import { ensureRerankModelSelected, isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import {
  useModelList,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'

const rowClass = `
  flex justify-between py-4 flex-wrap gap-y-2
`
const labelClass = `
  flex items-center w-[168px] h-9
`
const inputClass = `
  w-full max-w-[480px] px-3 bg-gray-100 text-sm text-gray-800 rounded-lg outline-none appearance-none
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
  const { setShowAccountSettingModal } = useModalContext()
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(currentDataset?.name ?? '')
  const [description, setDescription] = useState(currentDataset?.description ?? '')
  const [permission, setPermission] = useState(currentDataset?.permission)
  const [indexMethod, setIndexMethod] = useState(currentDataset?.indexing_technique)
  const [retrievalConfig, setRetrievalConfig] = useState(currentDataset?.retrieval_model_dict as RetrievalConfig)
  const [embeddingModel, setEmbeddingModel] = useState<DefaultModel>(
    currentDataset?.embedding_model
      ? {
        provider: currentDataset.embedding_model_provider,
        model: currentDataset.embedding_model,
      }
      : {
        provider: '',
        model: '',
      },
  )
  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
    currentModel: isRerankDefaultModelVaild,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)

  const handleSave = async () => {
    if (loading)
      return
    if (!name?.trim()) {
      notify({ type: 'error', message: t('datasetSettings.form.nameError') })
      return
    }
    if (
      !isReRankModelSelected({
        rerankDefaultModel,
        isRerankDefaultModelVaild: !!isRerankDefaultModelVaild,
        rerankModelList,
        retrievalConfig,
        indexMethod,
      })
    ) {
      notify({ type: 'error', message: t('appDebug.datasetConfig.rerankModelRequired') })
      return
    }
    const postRetrievalConfig = ensureRerankModelSelected({
      rerankDefaultModel: rerankDefaultModel!,
      retrievalConfig,
      indexMethod,
    })
    try {
      setLoading(true)
      await updateDatasetSetting({
        datasetId: currentDataset!.id,
        body: {
          name,
          description,
          permission,
          indexing_technique: indexMethod,
          retrieval_model: {
            ...postRetrievalConfig,
            score_threshold: postRetrievalConfig.score_threshold_enabled ? postRetrievalConfig.score_threshold : 0,
          },
          embedding_model: embeddingModel.model,
          embedding_model_provider: embeddingModel.provider,
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
    <div className='w-full sm:w-[800px] p-4 sm:px-16 sm:py-6'>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.name')}</div>
        </div>
        <input
          disabled={!currentDataset?.embedding_available}
          className={cn(inputClass, !currentDataset?.embedding_available && 'opacity-60', 'h-9')}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.desc')}</div>
        </div>
        <div className='w-full max-w-[480px]'>
          <textarea
            disabled={!currentDataset?.embedding_available}
            className={cn(`${inputClass} block mb-2 h-[120px] py-2 resize-none`, !currentDataset?.embedding_available && 'opacity-60')}
            placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <a className='flex items-center h-[18px] px-3 text-xs text-gray-500' href="https://docs.dify.ai/features/datasets#how-to-write-a-good-dataset-description" target='_blank' rel='noopener noreferrer'>
            <BookOpenIcon className='w-3 h-[18px] mr-1' />
            {t('datasetSettings.form.descWrite')}
          </a>
        </div>
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.permissions')}</div>
        </div>
        <div className='w-full sm:w-[480px]'>
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
            <div className='w-full sm:w-[480px]'>
              <IndexMethodRadio
                disable={!currentDataset?.embedding_available}
                value={indexMethod}
                onChange={v => setIndexMethod(v)}
              />
            </div>
          </div>
        </>
      )}
      {indexMethod === 'high_quality' && (
        <div className={rowClass}>
          <div className={labelClass}>
            <div>{t('datasetSettings.form.embeddingModel')}</div>
          </div>
          <div className='w-[480px]'>
            <ModelSelector
              triggerClassName=''
              defaultModel={embeddingModel}
              modelList={embeddingModelList}
              onSelect={(model: DefaultModel) => {
                setEmbeddingModel(model)
              }}
            />
          </div>
        </div>
      )}
      {/* Retrieval Method Config */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div>
            <div>{t('datasetSettings.form.retrievalSetting.title')}</div>
            <div className='leading-[18px] text-xs font-normal text-gray-500'>
              <a target='_blank' rel='noopener noreferrer' href='https://docs.dify.ai/features/retrieval-augment' className='text-[#155eef]'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
              {t('datasetSettings.form.retrievalSetting.description')}
            </div>
          </div>
        </div>
        <div className='w-[480px]'>
          {indexMethod === 'high_quality'
            ? (
              <RetrievalMethodConfig
                value={retrievalConfig}
                onChange={setRetrievalConfig}
              />
            )
            : (
              <EconomicalRetrievalMethodConfig
                value={retrievalConfig}
                onChange={setRetrievalConfig}
              />
            )}
        </div>
      </div>
      {currentDataset?.embedding_available && (
        <div className={rowClass}>
          <div className={labelClass} />
          <div className='w-[480px]'>
            <Button
              className='min-w-24'
              variant='primary'
              onClick={handleSave}
            >
              {t('datasetSettings.form.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Form
