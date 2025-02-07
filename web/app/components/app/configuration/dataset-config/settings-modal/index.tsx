import type { FC } from 'react'
import { useRef, useState } from 'react'
import { useMount } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { isEqual } from 'lodash-es'
import { RiCloseLine } from '@remixicon/react'
import { BookOpenIcon } from '@heroicons/react/24/outline'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import cn from '@/utils/classnames'
import IndexMethodRadio from '@/app/components/datasets/settings/index-method-radio'
import Divider from '@/app/components/base/divider'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { type DataSet, DatasetPermission } from '@/models/datasets'
import { useToastContext } from '@/app/components/base/toast'
import { updateDatasetSetting } from '@/service/datasets'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import type { RetrievalConfig } from '@/types/app'
import RetrievalSettings from '@/app/components/datasets/external-knowledge-base/create/RetrievalSettings'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import PermissionSelector from '@/app/components/datasets/settings/permission-selector'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import {
  useModelList,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fetchMembers } from '@/service/common'
import type { Member } from '@/models/common'

type SettingsModalProps = {
  currentDataset: DataSet
  onCancel: () => void
  onSave: (newDataset: DataSet) => void
}

const rowClass = `
  flex justify-between py-4 flex-wrap gap-y-2
`

const labelClass = `
  flex w-[168px] shrink-0
`

const SettingsModal: FC<SettingsModalProps> = ({
  currentDataset,
  onCancel,
  onSave,
}) => {
  const { data: embeddingsModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
    currentModel: isRerankDefaultModelValid,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const ref = useRef(null)
  const isExternal = currentDataset.provider === 'external'
  const [topK, setTopK] = useState(currentDataset?.external_retrieval_model.top_k ?? 2)
  const [scoreThreshold, setScoreThreshold] = useState(currentDataset?.external_retrieval_model.score_threshold ?? 0.5)
  const [scoreThresholdEnabled, setScoreThresholdEnabled] = useState(currentDataset?.external_retrieval_model.score_threshold_enabled ?? false)
  const { setShowAccountSettingModal } = useModalContext()
  const [loading, setLoading] = useState(false)
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()
  const [localeCurrentDataset, setLocaleCurrentDataset] = useState({ ...currentDataset })
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>(currentDataset.partial_member_list || [])
  const [memberList, setMemberList] = useState<Member[]>([])

  const [indexMethod, setIndexMethod] = useState(currentDataset.indexing_technique)
  const [retrievalConfig, setRetrievalConfig] = useState(localeCurrentDataset?.retrieval_model_dict as RetrievalConfig)

  const handleValueChange = (type: string, value: string) => {
    setLocaleCurrentDataset({ ...localeCurrentDataset, [type]: value })
  }
  const [isHideChangedTip, setIsHideChangedTip] = useState(false)
  const isRetrievalChanged = !isEqual(retrievalConfig, localeCurrentDataset?.retrieval_model_dict) || indexMethod !== localeCurrentDataset?.indexing_technique

  const handleSettingsChange = (data: { top_k?: number; score_threshold?: number; score_threshold_enabled?: boolean }) => {
    if (data.top_k !== undefined)
      setTopK(data.top_k)
    if (data.score_threshold !== undefined)
      setScoreThreshold(data.score_threshold)
    if (data.score_threshold_enabled !== undefined)
      setScoreThresholdEnabled(data.score_threshold_enabled)
  }

  const handleSave = async () => {
    if (loading)
      return
    if (!localeCurrentDataset.name?.trim()) {
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
    try {
      setLoading(true)
      const { id, name, description, permission } = localeCurrentDataset
      const requestParams = {
        datasetId: id,
        body: {
          name,
          description,
          permission,
          indexing_technique: indexMethod,
          retrieval_model: {
            ...retrievalConfig,
            score_threshold: retrievalConfig.score_threshold_enabled ? retrievalConfig.score_threshold : 0,
          },
          embedding_model: localeCurrentDataset.embedding_model,
          embedding_model_provider: localeCurrentDataset.embedding_model_provider,
          ...(isExternal && {
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
      onSave({
        ...localeCurrentDataset,
        indexing_technique: indexMethod,
        retrieval_model_dict: retrievalConfig,
      })
    }
    catch (e) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
    finally {
      setLoading(false)
    }
  }

  const getMembers = async () => {
    const { accounts } = await fetchMembers({ url: '/workspaces/current/members', params: {} })
    if (!accounts)
      setMemberList([])
    else
      setMemberList(accounts)
  }

  useMount(() => {
    getMembers()
  })

  return (
    <div
      className='overflow-hidden w-full flex flex-col bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl'
      style={{
        height: 'calc(100vh - 72px)',
      }}
      ref={ref}
    >
      <div className='shrink-0 flex justify-between items-center pl-6 pr-5 h-14 border-b border-b-gray-100'>
        <div className='flex flex-col text-base font-semibold text-gray-900'>
          <div className='leading-6'>{t('datasetSettings.title')}</div>
        </div>
        <div className='flex items-center'>
          <div
            onClick={onCancel}
            className='flex justify-center items-center w-6 h-6 cursor-pointer'
          >
            <RiCloseLine className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
      {/* Body */}
      <div className='p-6 pt-5 border-b overflow-y-auto pb-[68px]' style={{
        borderBottom: 'rgba(0, 0, 0, 0.05)',
      }}>
        <div className={cn(rowClass, 'items-center')}>
          <div className={labelClass}>
            <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.name')}</div>
          </div>
          <Input
            value={localeCurrentDataset.name}
            onChange={e => handleValueChange('name', e.target.value)}
            className='block h-9'
            placeholder={t('datasetSettings.form.namePlaceholder') || ''}
          />
        </div>
        <div className={cn(rowClass)}>
          <div className={labelClass}>
            <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.desc')}</div>
          </div>
          <div className='w-full'>
            <Textarea
              value={localeCurrentDataset.description || ''}
              onChange={e => handleValueChange('description', e.target.value)}
              className='resize-none'
              placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            />
            <a className='mt-2 flex items-center h-[18px] px-3 text-xs text-gray-500' href="https://docs.dify.ai/features/datasets#how-to-write-a-good-dataset-description" target='_blank' rel='noopener noreferrer'>
              <BookOpenIcon className='w-3 h-[18px] mr-1' />
              {t('datasetSettings.form.descWrite')}
            </a>
          </div>
        </div>
        <div className={rowClass}>
          <div className={labelClass}>
            <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.permissions')}</div>
          </div>
          <div className='w-full'>
            <PermissionSelector
              disabled={!localeCurrentDataset?.embedding_available || isCurrentWorkspaceDatasetOperator}
              permission={localeCurrentDataset.permission}
              value={selectedMemberIDs}
              onChange={v => handleValueChange('permission', v!)}
              onMemberSelect={setSelectedMemberIDs}
              memberList={memberList}
            />
          </div>
        </div>
        {currentDataset && currentDataset.indexing_technique && (
          <div className={cn(rowClass)}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.indexMethod')}</div>
            </div>
            <div className='grow'>
              <IndexMethodRadio
                disable={!localeCurrentDataset?.embedding_available}
                value={indexMethod}
                onChange={v => setIndexMethod(v!)}
                docForm={currentDataset.doc_form}
                currentValue={currentDataset.indexing_technique}
              />
            </div>
          </div>
        )}
        {indexMethod === 'high_quality' && (
          <div className={cn(rowClass)}>
            <div className={labelClass}>
              <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.embeddingModel')}</div>
            </div>
            <div className='w-full'>
              <div className='w-full h-9 rounded-lg bg-gray-100 opacity-60'>
                <ModelSelector
                  readonly
                  defaultModel={{
                    provider: localeCurrentDataset.embedding_model_provider,
                    model: localeCurrentDataset.embedding_model,
                  }}
                  modelList={embeddingsModelList}
                />
              </div>
              <div className='mt-2 w-full text-xs leading-6 text-gray-500'>
                {t('datasetSettings.form.embeddingModelTip')}
                <span className='text-[#155eef] cursor-pointer' onClick={() => setShowAccountSettingModal({ payload: 'provider' })}>{t('datasetSettings.form.embeddingModelTipLink')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Retrieval Method Config */}
        {currentDataset?.provider === 'external'
          ? <>
            <div className={rowClass}><Divider /></div>
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
            <div className={rowClass}><Divider /></div>
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
            <div className={rowClass}><Divider /></div>
          </>
          : <div className={rowClass}>
            <div className={cn(labelClass, 'w-auto min-w-[168px]')}>
              <div>
                <div className='text-text-secondary system-sm-semibold'>{t('datasetSettings.form.retrievalSetting.title')}</div>
                <div className='leading-[18px] text-xs font-normal text-gray-500'>
                  <a target='_blank' rel='noopener noreferrer' href='https://docs.dify.ai/guides/knowledge-base/create-knowledge-and-upload-documents#id-4-retrieval-settings' className='text-[#155eef]'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
                  {t('datasetSettings.form.retrievalSetting.description')}
                </div>
              </div>
            </div>
            <div>
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
          </div>}
      </div>
      {isRetrievalChanged && !isHideChangedTip && (
        <div className='absolute z-10 left-[30px] right-[30px] bottom-[76px] flex h-10 items-center px-3 rounded-lg border border-[#FEF0C7] bg-[#FFFAEB] shadow-lg justify-between'>
          <div className='flex items-center'>
            <AlertTriangle className='mr-1 w-3 h-3 text-[#F79009]' />
            <div className='leading-[18px] text-xs font-medium text-gray-700'>{t('appDebug.datasetConfig.retrieveChangeTip')}</div>
          </div>
          <div className='p-1 cursor-pointer' onClick={(e) => {
            setIsHideChangedTip(true)
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
          }}>
            <RiCloseLine className='w-4 h-4 text-gray-500 ' />
          </div>
        </div>
      )}

      <div
        className='sticky z-[5] bottom-0 w-full flex justify-end py-4 px-6 border-t bg-white '
        style={{
          borderColor: 'rgba(0, 0, 0, 0.05)',
        }}
      >
        <Button
          onClick={onCancel}
          className='mr-2'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          disabled={loading}
          onClick={handleSave}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </div>
  )
}

export default SettingsModal
