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
import { IndexingType } from '../../create/step-two'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import { updateDatasetSetting } from '@/service/datasets'
import { type DataSetListResponse, DatasetPermission } from '@/models/datasets'
import DatasetDetailContext from '@/context/dataset-detail'
import { type RetrievalConfig } from '@/types/app'
import { useAppContext } from '@/context/app-context'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import {
  useModelList,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fetchMembers } from '@/service/common'
import type { Member } from '@/models/common'
import AlertTriangle from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback/AlertTriangle'

const rowClass = 'flex'
const labelClass = `
  flex items-center shrink-0 w-[180px] h-9
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
        rerankModelList,
        retrievalConfig,
        indexMethod,
      })
    ) {
      notify({ type: 'error', message: t('appDebug.datasetConfig.rerankModelRequired') })
      return
    }
    if (retrievalConfig.weights) {
      retrievalConfig.weights.vector_setting.embedding_provider_name = currentDataset?.embedding_model_provider || ''
      retrievalConfig.weights.vector_setting.embedding_model_name = currentDataset?.embedding_model || ''
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
            ...retrievalConfig,
            score_threshold: retrievalConfig.score_threshold_enabled ? retrievalConfig.score_threshold : 0,
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
      if (permission === DatasetPermission.partialMembers) {
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
    <div className='w-full sm:w-[880px] px-14 py-8 flex flex-col gap-y-4'>
      <div className={rowClass}>
        <div className={labelClass}>
          <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.name')}</div>
        </div>
        <div className='grow'>
          <Input
            disabled={!currentDataset?.embedding_available}
            className='h-9'
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.desc')}</div>
        </div>
        <div className='grow'>
          <Textarea
            disabled={!currentDataset?.embedding_available}
            className='h-[120px] resize-none'
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
        <div className='grow'>
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
          <div className='w-full h-0 border-b border-divider-subtle my-1' />
          <div className={rowClass}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.indexMethod')}</div>
            </div>
            <div className='grow'>
              <IndexMethodRadio
                disable={!currentDataset?.embedding_available}
                value={indexMethod}
                onChange={v => setIndexMethod(v!)}
                docForm={currentDataset.doc_form}
                currentValue={currentDataset.indexing_technique}
              />
              {currentDataset.indexing_technique === IndexingType.ECONOMICAL && indexMethod === IndexingType.QUALIFIED && <div className='mt-2 h-10 p-2 flex items-center gap-x-0.5 rounded-xl border-[0.5px] border-components-panel-border overflow-hidden bg-components-panel-bg-blur backdrop-blur-[5px] shadow-xs'>
                <div className='absolute top-0 left-0 right-0 bottom-0 bg-[linear-gradient(92deg,rgba(247,144,9,0.25)_0%,rgba(255,255,255,0.00)_100%)] opacity-40'></div>
                <div className='p-1'>
                  <AlertTriangle className='size-4 text-text-warning-secondary' />
                </div>
                <span className='system-xs-medium'>{t('datasetSettings.form.upgradeHighQualityTip')}</span>
              </div>}
            </div>
          </div>
        </>
      )}
      {indexMethod === 'high_quality' && (
        <>
          <div className={rowClass}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.embeddingModel')}</div>
            </div>
            <div className='grow'>
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
        </>
      )}
      {/* Retrieval Method Config */}
      {currentDataset?.provider === 'external'
        ? <>
          <div className='w-full h-0 border-b border-divider-subtle my-1' />
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
          <div className='w-full h-0 border-b border-divider-subtle my-1' />
          <div className={rowClass}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.externalKnowledgeAPI')}</div>
            </div>
            <div className='w-full'>
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
            <div className='w-full'>
              <div className='flex h-full px-3 py-2 items-center gap-1 rounded-lg bg-components-input-bg-normal'>
                <div className='text-text-tertiary system-xs-regular'>{currentDataset?.external_knowledge_info.external_knowledge_id}</div>
              </div>
            </div>
          </div>
        </>
        : indexMethod
          ? <>
            <div className='w-full h-0 border-b border-divider-subtle my-1' />
            <div className={rowClass}>
              <div className={labelClass}>
                <div>
                  <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.retrievalSetting.title')}</div>
                  <div className='body-xs-regular text-text-tertiary'>
                    <a target='_blank' rel='noopener noreferrer' href='https://docs.dify.ai/guides/knowledge-base/create-knowledge-and-upload-documents#id-4-retrieval-settings' className='text-text-accent'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
                    {t('datasetSettings.form.retrievalSetting.description')}
                  </div>
                </div>
              </div>
              <div className='grow'>
                {indexMethod === IndexingType.QUALIFIED
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
          </>
          : null
      }
      <div className='w-full h-0 border-b border-divider-subtle my-1' />
      <div className={rowClass}>
        <div className={labelClass} />
        <div className='grow'>
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
