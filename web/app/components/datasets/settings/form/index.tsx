'use client'
import { useState } from 'react'
import { useMount } from 'ahooks'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useSWRConfig } from 'swr'
import { unstable_serialize } from 'swr/infinite'
import PermissionSelector from '../permission-selector'
import IndexMethodRadio from '../index-method-radio'
import RetrievalSettings from '../../external-knowledge-base/create/RetrievalSettings'
import cn from '@/utils/classnames'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import { updateDatasetSetting } from '@/service/datasets'
import type { DataSetListResponse } from '@/models/datasets'
import DatasetDetailContext from '@/context/dataset-detail'
import { type RetrievalConfig } from '@/types/app'
import { useAppContext } from '@/context/app-context'
import { ensureRerankModelSelected, isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import {
  useModelList,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fetchMembers } from '@/service/common'
import type { Member } from '@/models/common'

const rowClass = `
  flex justify-between py-4 flex-wrap gap-y-2
`
const labelClass = `
  flex items-center w-[168px] h-9
`
const inputClass = `
  w-full max-w-[480px] px-3 bg-gray-100 text-sm text-gray-800 rounded-lg outline-none appearance-none
`

const getKey = (pageIndex: number, previousPageData: DataSetListResponse) => {
  if (!pageIndex || previousPageData.has_more)
    return { url: 'datasets', params: { page: pageIndex + 1, limit: 30 } }
  return null
}

const Form = () => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { mutate } = useSWRConfig()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()
  const { dataset: currentDataset, mutateDatasetRes: mutateDatasets } = useContext(DatasetDetailContext)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(currentDataset?.name ?? '')
  const [description, setDescription] = useState(currentDataset?.description ?? '')
  const [permission, setPermission] = useState(currentDataset?.permission)
  const [topK, setTopK] = useState(currentDataset?.external_retrieval_model.top_k ?? 2)
  const [scoreThreshold, setScoreThreshold] = useState(currentDataset?.external_retrieval_model.score_threshold ?? 0.5)
  const [scoreThresholdEnabled, setScoreThresholdEnabled] = useState(currentDataset?.external_retrieval_model.score_threshold_enabled ?? false)
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>(currentDataset?.partial_member_list || [])
  const [memberList, setMemberList] = useState<Member[]>([])
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
    currentModel: isRerankDefaultModelValid,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)

  const getMembers = async () => {
    const { accounts } = await fetchMembers({ url: '/workspaces/current/members', params: {} })
    if (!accounts)
      setMemberList([])
    else
      setMemberList(accounts)
  }

  const handleSettingsChange = (data: { top_k?: number; score_threshold?: number; score_threshold_enabled?: boolean }) => {
    if (data.top_k !== undefined)
      setTopK(data.top_k)
    if (data.score_threshold !== undefined)
      setScoreThreshold(data.score_threshold)
    if (data.score_threshold_enabled !== undefined)
      setScoreThresholdEnabled(data.score_threshold_enabled)
  }

  useMount(() => {
    getMembers()
  })

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
        isRerankDefaultModelValid: !!isRerankDefaultModelValid,
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
    if (postRetrievalConfig.weights) {
      postRetrievalConfig.weights.vector_setting.embedding_provider_name = currentDataset?.embedding_model_provider || ''
      postRetrievalConfig.weights.vector_setting.embedding_model_name = currentDataset?.embedding_model || ''
    }
    try {
      setLoading(true)
      const requestParams = {
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
          ...(currentDataset!.provider === 'external' && {
            external_knowledge_id: currentDataset!.external_knowledge_info.external_knowledge_id,
            external_knowledge_api_id: currentDataset!.external_knowledge_info.external_knowledge_api_id,
            external_retrieval_model: {
              top_k: topK,
              score_threshold: scoreThreshold,
              score_threshold_enabled: scoreThresholdEnabled,
            },
          }),
        },
      } as any
      if (permission === 'partial_members') {
        requestParams.body.partial_member_list = selectedMemberIDs.map((id) => {
          return {
            user_id: id,
            role: memberList.find(member => member.id === id)?.role,
          }
        })
      }
      await updateDatasetSetting(requestParams)
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

  return (
    <div className='w-full sm:w-[800px] p-4 sm:px-16 sm:py-6'>
      <div className={rowClass}>
        <div className={labelClass}>
          <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.name')}</div>
        </div>
        <div className='w-full max-w-[480px]'>
          <input
            disabled={!currentDataset?.embedding_available}
            className={cn(inputClass, !currentDataset?.embedding_available && 'opacity-60', 'h-9')}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.desc')}</div>
        </div>
        <div className='w-full max-w-[480px]'>
          <textarea
            disabled={!currentDataset?.embedding_available}
            className={cn(`${inputClass} block mb-2 h-[120px] py-2 resize-none`, !currentDataset?.embedding_available && 'opacity-60')}
            placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.permissions')}</div>
        </div>
        <div className='w-full sm:w-[480px]'>
          <PermissionSelector
            disabled={!currentDataset?.embedding_available || isCurrentWorkspaceDatasetOperator}
            permission={permission}
            value={selectedMemberIDs}
            onChange={v => setPermission(v)}
            onMemberSelect={setSelectedMemberIDs}
            memberList={memberList}
          />
        </div>
      </div>
      {currentDataset && currentDataset.indexing_technique && (
        <>
          <div className='w-full h-0 border-b-[0.5px] border-b-gray-200 my-2' />
          <div className={rowClass}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.indexMethod')}</div>
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
            <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.embeddingModel')}</div>
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
      {currentDataset?.provider === 'external'
        ? <>
          <div className={rowClass}><Divider/></div>
          <div className={rowClass}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.retrievalSetting.title')}</div>
            </div>
            <RetrievalSettings
              topK={topK}
              scoreThreshold={scoreThreshold}
              scoreThresholdEnabled={scoreThresholdEnabled}
              onChange={handleSettingsChange}
              isInRetrievalSetting={true}
            />
          </div>
          <div className={rowClass}><Divider/></div>
          <div className={rowClass}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.externalKnowledgeAPI')}</div>
            </div>
            <div className='w-full max-w-[480px]'>
              <div className='flex h-full px-3 py-2 items-center gap-1 rounded-lg bg-components-input-bg-normal'>
                <ApiConnectionMod className='w-4 h-4 text-text-secondary' />
                <div className='overflow-hidden text-text-secondary text-ellipsis system-sm-medium'>
                  {currentDataset?.external_knowledge_info.external_knowledge_api_name}
                </div>
                <div className='text-text-tertiary system-xs-regular'>·</div>
                <div className='text-text-tertiary system-xs-regular'>{currentDataset?.external_knowledge_info.external_knowledge_api_endpoint}</div>
              </div>
            </div>
          </div>
          <div className={rowClass}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.externalKnowledgeID')}</div>
            </div>
            <div className='w-full max-w-[480px]'>
              <div className='flex h-full px-3 py-2 items-center gap-1 rounded-lg bg-components-input-bg-normal'>
                <div className='text-text-tertiary system-xs-regular'>{currentDataset?.external_knowledge_info.external_knowledge_id}</div>
              </div>
            </div>
          </div>
          <div className={rowClass}><Divider/></div>
        </>
        : <div className={rowClass}>
          <div className={labelClass}>
            <div>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.retrievalSetting.title')}</div>
              <div className='leading-[18px] text-xs font-normal text-gray-500'>
                <a target='_blank' rel='noopener noreferrer' href='https://docs.dify.ai/guides/knowledge-base/create-knowledge-and-upload-documents#id-4-retrieval-settings' className='text-[#155eef]'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
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
      }
      <div className={rowClass}>
        <div className={labelClass} />
        <div className='w-[480px]'>
          <Button
            className='min-w-24'
            variant='primary'
            loading={loading}
            disabled={loading}
            onClick={handleSave}
          >
            {t('datasetSettings.form.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default Form
