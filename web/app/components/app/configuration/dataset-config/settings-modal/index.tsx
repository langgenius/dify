import type { FC } from 'react'
import { useRef, useState } from 'react'
import { useMount } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { isEqual } from 'lodash-es'
import { RiCloseLine } from '@remixicon/react'
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
  const { setShowAccountSettingModal } = useModalContext()
  const [loading, setLoading] = useState(false)
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()
  const [localeCurrentDataset, setLocaleCurrentDataset] = useState({ ...currentDataset })
  const [topK, setTopK] = useState(localeCurrentDataset?.external_retrieval_model.top_k ?? 2)
  const [scoreThreshold, setScoreThreshold] = useState(localeCurrentDataset?.external_retrieval_model.score_threshold ?? 0.5)
  const [scoreThresholdEnabled, setScoreThresholdEnabled] = useState(localeCurrentDataset?.external_retrieval_model.score_threshold_enabled ?? false)
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

    setLocaleCurrentDataset({
      ...localeCurrentDataset,
      external_retrieval_model: {
        ...localeCurrentDataset?.external_retrieval_model,
        ...data,
      },
    })
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
    catch {
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
      className='flex w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'
      style={{
        height: 'calc(100vh - 72px)',
      }}
      ref={ref}
    >
      <div className='flex h-14 shrink-0 items-center justify-between border-b border-divider-regular pl-6 pr-5'>
        <div className='flex flex-col text-base font-semibold text-text-primary'>
          <div className='leading-6'>{t('datasetSettings.title')}</div>
        </div>
        <div className='flex items-center'>
          <div
            onClick={onCancel}
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
          >
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      {/* Body */}
      <div className='overflow-y-auto border-b border-divider-regular p-6 pb-[68px] pt-5'>
        <div className={cn(rowClass, 'items-center')}>
          <div className={labelClass}>
            <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.name')}</div>
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
            <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.desc')}</div>
          </div>
          <div className='w-full'>
            <Textarea
              value={localeCurrentDataset.description || ''}
              onChange={e => handleValueChange('description', e.target.value)}
              className='resize-none'
              placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            />
          </div>
        </div>
        <div className={rowClass}>
          <div className={labelClass}>
            <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.permissions')}</div>
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
              <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.indexMethod')}</div>
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
              <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.embeddingModel')}</div>
            </div>
            <div className='w-full'>
              <div className='h-8 w-full rounded-lg bg-components-input-bg-normal opacity-60'>
                <ModelSelector
                  readonly
                  defaultModel={{
                    provider: localeCurrentDataset.embedding_model_provider,
                    model: localeCurrentDataset.embedding_model,
                  }}
                  modelList={embeddingsModelList}
                />
              </div>
              <div className='mt-2 w-full text-xs leading-6 text-text-tertiary'>
                {t('datasetSettings.form.embeddingModelTip')}
                <span className='cursor-pointer text-text-accent' onClick={() => setShowAccountSettingModal({ payload: 'provider' })}>{t('datasetSettings.form.embeddingModelTipLink')}</span>
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
                <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.retrievalSetting.title')}</div>
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
                <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.externalKnowledgeAPI')}</div>
              </div>
              <div className='w-full max-w-[480px]'>
                <div className='flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2'>
                  <ApiConnectionMod className='h-4 w-4 text-text-secondary' />
                  <div className='system-sm-medium overflow-hidden text-ellipsis text-text-secondary'>
                    {currentDataset?.external_knowledge_info.external_knowledge_api_name}
                  </div>
                  <div className='system-xs-regular text-text-tertiary'>·</div>
                  <div className='system-xs-regular text-text-tertiary'>{currentDataset?.external_knowledge_info.external_knowledge_api_endpoint}</div>
                </div>
              </div>
            </div>
            <div className={rowClass}>
              <div className={labelClass}>
                <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.externalKnowledgeID')}</div>
              </div>
              <div className='w-full max-w-[480px]'>
                <div className='flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2'>
                  <div className='system-xs-regular text-text-tertiary'>{currentDataset?.external_knowledge_info.external_knowledge_id}</div>
                </div>
              </div>
            </div>
            <div className={rowClass}><Divider /></div>
          </>
          : <div className={rowClass}>
            <div className={cn(labelClass, 'w-auto min-w-[168px]')}>
              <div>
                <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.retrievalSetting.title')}</div>
                <div className='text-xs font-normal leading-[18px] text-text-tertiary'>
                  <a target='_blank' rel='noopener noreferrer' href='https://docs.dify.ai/guides/knowledge-base/create-knowledge-and-upload-documents#id-4-retrieval-settings' className='text-text-accent'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
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
        <div className='absolute bottom-[76px] left-[30px] right-[30px] z-10 flex h-10 items-center justify-between rounded-lg border border-[#FEF0C7] bg-[#FFFAEB] px-3 shadow-lg'>
          <div className='flex items-center'>
            <AlertTriangle className='mr-1 h-3 w-3 text-[#F79009]' />
            <div className='text-xs font-medium leading-[18px] text-gray-700'>{t('appDebug.datasetConfig.retrieveChangeTip')}</div>
          </div>
          <div className='cursor-pointer p-1' onClick={(e) => {
            setIsHideChangedTip(true)
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
          }}>
            <RiCloseLine className='h-4 w-4 text-gray-500' />
          </div>
        </div>
      )}

      <div
        className='sticky bottom-0 z-[5] flex w-full justify-end border-t border-divider-regular bg-background-section px-6 py-4'
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
