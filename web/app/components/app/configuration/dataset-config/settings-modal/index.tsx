import type { FC } from 'react'
import type { Member } from '@/models/common'
import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { RiCloseLine } from '@remixicon/react'
import { isEqual } from 'es-toolkit/predicate'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { useToastContext } from '@/app/components/base/toast'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import IndexMethod from '@/app/components/datasets/settings/index-method'
import PermissionSelector from '@/app/components/datasets/settings/permission-selector'
import { checkShowMultiModalTip } from '@/app/components/datasets/settings/utils'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { DatasetPermission } from '@/models/datasets'
import { updateDatasetSetting } from '@/service/datasets'
import { useMembers } from '@/service/use-common'
import { cn } from '@/utils/classnames'
import { RetrievalChangeTip, RetrievalSection } from './retrieval-section'

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
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)
  const { t } = useTranslation()
  const docLink = useDocLink()
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
  const { data: membersData } = useMembers()

  const [indexMethod, setIndexMethod] = useState(currentDataset.indexing_technique)
  const [retrievalConfig, setRetrievalConfig] = useState(localeCurrentDataset?.retrieval_model_dict as RetrievalConfig)
  const [keywordNumber, setKeywordNumber] = useState(currentDataset.keyword_number ?? 10)

  const handleValueChange = (type: string, value: string) => {
    setLocaleCurrentDataset({ ...localeCurrentDataset, [type]: value })
  }
  const [isHideChangedTip, setIsHideChangedTip] = useState(false)
  const isRetrievalChanged = !isEqual(retrievalConfig, localeCurrentDataset?.retrieval_model_dict) || indexMethod !== localeCurrentDataset?.indexing_technique

  const handleSettingsChange = (data: { top_k?: number, score_threshold?: number, score_threshold_enabled?: boolean }) => {
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
      notify({ type: 'error', message: t('form.nameError', { ns: 'datasetSettings' }) })
      return
    }
    if (
      !isReRankModelSelected({
        rerankModelList,
        retrievalConfig,
        indexMethod,
      })
    ) {
      notify({ type: 'error', message: t('datasetConfig.rerankModelRequired', { ns: 'appDebug' }) })
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
          keyword_number: keywordNumber,
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
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      onSave({
        ...localeCurrentDataset,
        indexing_technique: indexMethod,
        retrieval_model_dict: retrievalConfig,
      })
    }
    catch {
      notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!membersData?.accounts)
      setMemberList([])
    else
      setMemberList(membersData.accounts)
  }, [membersData])

  const showMultiModalTip = useMemo(() => {
    return checkShowMultiModalTip({
      embeddingModel: {
        provider: localeCurrentDataset.embedding_model_provider,
        model: localeCurrentDataset.embedding_model,
      },
      rerankingEnable: retrievalConfig.reranking_enable,
      rerankModel: {
        rerankingProviderName: retrievalConfig.reranking_model.reranking_provider_name,
        rerankingModelName: retrievalConfig.reranking_model.reranking_model_name,
      },
      indexMethod,
      embeddingModelList,
      rerankModelList,
    })
  }, [localeCurrentDataset.embedding_model, localeCurrentDataset.embedding_model_provider, retrievalConfig.reranking_enable, retrievalConfig.reranking_model, indexMethod, embeddingModelList, rerankModelList])

  return (
    <div
      className="flex w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl"
      style={{
        height: 'calc(100vh - 72px)',
      }}
      ref={ref}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-divider-regular pl-6 pr-5">
        <div className="flex flex-col text-base font-semibold text-text-primary">
          <div className="leading-6">{t('title', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="flex items-center">
          <div
            onClick={onCancel}
            className="flex h-6 w-6 cursor-pointer items-center justify-center"
          >
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      {/* Body */}
      <div className="overflow-y-auto border-b border-divider-regular p-6 pb-[68px] pt-5">
        <div className={cn(rowClass, 'items-center')}>
          <div className={labelClass}>
            <div className="system-sm-semibold text-text-secondary">{t('form.name', { ns: 'datasetSettings' })}</div>
          </div>
          <Input
            value={localeCurrentDataset.name}
            onChange={e => handleValueChange('name', e.target.value)}
            className="block h-9"
            placeholder={t('form.namePlaceholder', { ns: 'datasetSettings' }) || ''}
          />
        </div>
        <div className={cn(rowClass)}>
          <div className={labelClass}>
            <div className="system-sm-semibold text-text-secondary">{t('form.desc', { ns: 'datasetSettings' })}</div>
          </div>
          <div className="w-full">
            <Textarea
              value={localeCurrentDataset.description || ''}
              onChange={e => handleValueChange('description', e.target.value)}
              className="resize-none"
              placeholder={t('form.descPlaceholder', { ns: 'datasetSettings' }) || ''}
            />
          </div>
        </div>
        <div className={rowClass}>
          <div className={labelClass}>
            <div className="system-sm-semibold text-text-secondary">{t('form.permissions', { ns: 'datasetSettings' })}</div>
          </div>
          <div className="w-full">
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
        {!!(currentDataset && currentDataset.indexing_technique) && (
          <div className={cn(rowClass)}>
            <div className={labelClass}>
              <div className="system-sm-semibold text-text-secondary">{t('form.indexMethod', { ns: 'datasetSettings' })}</div>
            </div>
            <div className="grow">
              <IndexMethod
                disabled={!localeCurrentDataset?.embedding_available}
                value={indexMethod}
                onChange={setIndexMethod}
                currentValue={currentDataset.indexing_technique}
                keywordNumber={keywordNumber}
                onKeywordNumberChange={setKeywordNumber}
              />
            </div>
          </div>
        )}
        {indexMethod === IndexingType.QUALIFIED && (
          <div className={cn(rowClass)}>
            <div className={labelClass}>
              <div className="system-sm-semibold text-text-secondary">{t('form.embeddingModel', { ns: 'datasetSettings' })}</div>
            </div>
            <div className="w-full">
              <div className="h-8 w-full rounded-lg bg-components-input-bg-normal opacity-60">
                <ModelSelector
                  readonly
                  defaultModel={{
                    provider: localeCurrentDataset.embedding_model_provider,
                    model: localeCurrentDataset.embedding_model,
                  }}
                  modelList={embeddingModelList}
                />
              </div>
              <div className="mt-2 w-full text-xs leading-6 text-text-tertiary">
                {t('form.embeddingModelTip', { ns: 'datasetSettings' })}
                <span className="cursor-pointer text-text-accent" onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })}>{t('form.embeddingModelTipLink', { ns: 'datasetSettings' })}</span>
              </div>
            </div>
          </div>
        )}

        {/* Retrieval Method Config */}
        {isExternal
          ? (
              <RetrievalSection
                isExternal
                rowClass={rowClass}
                labelClass={labelClass}
                t={t as any}
                topK={topK}
                scoreThreshold={scoreThreshold}
                scoreThresholdEnabled={scoreThresholdEnabled}
                onExternalSettingChange={handleSettingsChange}
                currentDataset={currentDataset}
              />
            )
          : (
              <RetrievalSection
                isExternal={false}
                rowClass={rowClass}
                labelClass={labelClass}
                t={t as any}
                indexMethod={indexMethod}
                retrievalConfig={retrievalConfig}
                showMultiModalTip={showMultiModalTip}
                onRetrievalConfigChange={setRetrievalConfig}
                docLink={docLink}
              />
            )}
      </div>
      <RetrievalChangeTip
        visible={isRetrievalChanged && !isHideChangedTip}
        message={t('datasetConfig.retrieveChangeTip', { ns: 'appDebug' })}
        onDismiss={() => setIsHideChangedTip(true)}
      />

      <div
        className="sticky bottom-0 z-[5] flex w-full justify-end border-t border-divider-regular bg-background-section px-6 py-4"
      >
        <Button
          onClick={onCancel}
          className="mr-2"
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          variant="primary"
          disabled={loading}
          onClick={handleSave}
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}

export default SettingsModal
