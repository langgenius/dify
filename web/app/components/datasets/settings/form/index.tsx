'use client'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Member } from '@/models/common'
import type { IconInfo, SummaryIndexSetting as SummaryIndexSettingType } from '@/models/datasets'
import type { AppIconType, RetrievalConfig } from '@/types/app'
import { RiAlertFill } from '@remixicon/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDocLink } from '@/context/i18n'
import { ChunkingMode, DatasetPermission } from '@/models/datasets'
import { updateDatasetSetting } from '@/service/datasets'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { useMembers } from '@/service/use-common'
import { IndexingType } from '../../create/step-two'
import RetrievalSettings from '../../external-knowledge-base/create/RetrievalSettings'
import ChunkStructure from '../chunk-structure'
import IndexMethod from '../index-method'
import PermissionSelector from '../permission-selector'
import SummaryIndexSetting from '../summary-index-setting'
import { checkShowMultiModalTip } from '../utils'

const rowClass = 'flex gap-x-1'
const labelClass = 'flex items-center shrink-0 w-[180px] h-7 pt-1'

const DEFAULT_APP_ICON: IconInfo = {
  icon_type: 'emoji',
  icon: '📙',
  icon_background: '#FFF4ED',
  icon_url: '',
}

const Form = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const isCurrentWorkspaceDatasetOperator = useAppContextWithSelector(state => state.isCurrentWorkspaceDatasetOperator)
  const currentDataset = useDatasetDetailContextWithSelector(state => state.dataset)
  const mutateDatasets = useDatasetDetailContextWithSelector(state => state.mutateDatasetRes)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(currentDataset?.name ?? '')
  const [iconInfo, setIconInfo] = useState(currentDataset?.icon_info || DEFAULT_APP_ICON)
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [description, setDescription] = useState(currentDataset?.description ?? '')
  const [permission, setPermission] = useState(currentDataset?.permission)
  const [topK, setTopK] = useState(currentDataset?.external_retrieval_model.top_k ?? 2)
  const [scoreThreshold, setScoreThreshold] = useState(currentDataset?.external_retrieval_model.score_threshold ?? 0.5)
  const [scoreThresholdEnabled, setScoreThresholdEnabled] = useState(currentDataset?.external_retrieval_model.score_threshold_enabled ?? false)
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>(currentDataset?.partial_member_list || [])
  const [memberList, setMemberList] = useState<Member[]>([])
  const [indexMethod, setIndexMethod] = useState(currentDataset?.indexing_technique)
  const [keywordNumber, setKeywordNumber] = useState(currentDataset?.keyword_number ?? 10)
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
  const [summaryIndexSetting, setSummaryIndexSetting] = useState(currentDataset?.summary_index_setting)
  const handleSummaryIndexSettingChange = useCallback((payload: SummaryIndexSettingType) => {
    setSummaryIndexSetting((prev) => {
      return { ...prev, ...payload }
    })
  }, [])
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: membersData } = useMembers()
  const previousAppIcon = useRef(DEFAULT_APP_ICON)

  const handleOpenAppIconPicker = useCallback(() => {
    setShowAppIconPicker(true)
    previousAppIcon.current = iconInfo
  }, [iconInfo])

  const handleSelectAppIcon = useCallback((icon: AppIconSelection) => {
    const iconInfo: IconInfo = {
      icon_type: icon.type,
      icon: icon.type === 'emoji' ? icon.icon : icon.fileId,
      icon_background: icon.type === 'emoji' ? icon.background : undefined,
      icon_url: icon.type === 'emoji' ? undefined : icon.url,
    }
    setIconInfo(iconInfo)
    setShowAppIconPicker(false)
  }, [])

  const handleCloseAppIconPicker = useCallback(() => {
    setIconInfo(previousAppIcon.current)
    setShowAppIconPicker(false)
  }, [])

  const handleSettingsChange = useCallback((data: { top_k?: number, score_threshold?: number, score_threshold_enabled?: boolean }) => {
    if (data.top_k !== undefined)
      setTopK(data.top_k)
    if (data.score_threshold !== undefined)
      setScoreThreshold(data.score_threshold)
    if (data.score_threshold_enabled !== undefined)
      setScoreThresholdEnabled(data.score_threshold_enabled)
  }, [])

  useEffect(() => {
    if (!membersData?.accounts)
      setMemberList([])
    else
      setMemberList(membersData.accounts)
  }, [membersData])

  const invalidDatasetList = useInvalidDatasetList()
  const handleSave = async () => {
    if (loading)
      return
    if (!name?.trim()) {
      Toast.notify({ type: 'error', message: t('form.nameError', { ns: 'datasetSettings' }) })
      return
    }
    if (
      !isReRankModelSelected({
        rerankModelList,
        retrievalConfig,
        indexMethod,
      })
    ) {
      Toast.notify({ type: 'error', message: t('datasetConfig.rerankModelRequired', { ns: 'appDebug' }) })
      return
    }
    if (retrievalConfig.weights) {
      retrievalConfig.weights.vector_setting.embedding_provider_name = embeddingModel.provider || ''
      retrievalConfig.weights.vector_setting.embedding_model_name = embeddingModel.model || ''
    }
    try {
      setLoading(true)
      const requestParams = {
        datasetId: currentDataset!.id,
        body: {
          name,
          icon_info: iconInfo,
          doc_form: currentDataset?.doc_form,
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
          keyword_number: keywordNumber,
          summary_index_setting: summaryIndexSetting,
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
      Toast.notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      if (mutateDatasets) {
        await mutateDatasets()
        invalidDatasetList()
      }
    }
    catch {
      Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
    }
    finally {
      setLoading(false)
    }
  }

  const isShowIndexMethod = currentDataset && currentDataset.doc_form !== ChunkingMode.parentChild && currentDataset.indexing_technique && indexMethod

  const showMultiModalTip = useMemo(() => {
    return checkShowMultiModalTip({
      embeddingModel,
      rerankingEnable: retrievalConfig.reranking_enable,
      rerankModel: {
        rerankingProviderName: retrievalConfig.reranking_model.reranking_provider_name,
        rerankingModelName: retrievalConfig.reranking_model.reranking_model_name,
      },
      indexMethod,
      embeddingModelList,
      rerankModelList,
    })
  }, [embeddingModel, rerankModelList, retrievalConfig.reranking_enable, retrievalConfig.reranking_model, embeddingModelList, indexMethod])

  return (
    <div className="flex w-full flex-col gap-y-4 px-20 py-8 sm:w-[960px]">
      {/* Dataset name and icon */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">{t('form.nameAndIcon', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="flex grow items-center gap-x-2">
          <AppIcon
            size="small"
            onClick={handleOpenAppIconPicker}
            className="cursor-pointer"
            iconType={iconInfo.icon_type as AppIconType}
            icon={iconInfo.icon}
            background={iconInfo.icon_background}
            imageUrl={iconInfo.icon_url}
            showEditIcon
          />
          <Input
            disabled={!currentDataset?.embedding_available}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
      </div>
      {/* Dataset description */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">{t('form.desc', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="grow">
          <Textarea
            disabled={!currentDataset?.embedding_available}
            className="resize-none"
            placeholder={t('form.descPlaceholder', { ns: 'datasetSettings' }) || ''}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
      </div>
      {/* Permissions */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">{t('form.permissions', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="grow">
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
      {
        !!currentDataset?.doc_form && (
          <>
            <Divider
              type="horizontal"
              className="my-1 h-px bg-divider-subtle"
            />
            {/* Chunk Structure */}
            <div className={rowClass}>
              <div className="flex w-[180px] shrink-0 flex-col">
                <div className="system-sm-semibold flex h-8 items-center text-text-secondary">
                  {t('form.chunkStructure.title', { ns: 'datasetSettings' })}
                </div>
                <div className="body-xs-regular text-text-tertiary">
                  <a
                    target="_blank"
                    rel="noopener noreferrer"
                    href={docLink('/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text')}
                    className="text-text-accent"
                  >
                    {t('form.chunkStructure.learnMore', { ns: 'datasetSettings' })}
                  </a>
                  {t('form.chunkStructure.description', { ns: 'datasetSettings' })}
                </div>
              </div>
              <div className="grow">
                <ChunkStructure
                  chunkStructure={currentDataset?.doc_form}
                />
              </div>
            </div>
          </>
        )
      }
      {!!(isShowIndexMethod || indexMethod === 'high_quality') && (
        <Divider
          type="horizontal"
          className="my-1 h-px bg-divider-subtle"
        />
      )}
      {!!isShowIndexMethod && (
        <div className={rowClass}>
          <div className={labelClass}>
            <div className="system-sm-semibold text-text-secondary">{t('form.indexMethod', { ns: 'datasetSettings' })}</div>
          </div>
          <div className="grow">
            <IndexMethod
              value={indexMethod}
              disabled={!currentDataset?.embedding_available}
              onChange={v => setIndexMethod(v!)}
              currentValue={currentDataset.indexing_technique}
              keywordNumber={keywordNumber}
              onKeywordNumberChange={setKeywordNumber}
            />
            {currentDataset.indexing_technique === IndexingType.ECONOMICAL && indexMethod === IndexingType.QUALIFIED && (
              <div className="relative mt-2 flex h-10 items-center gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-2 shadow-xs shadow-shadow-shadow-3">
                <div className="absolute left-0 top-0 flex h-full w-full items-center bg-toast-warning-bg opacity-40" />
                <div className="p-1">
                  <RiAlertFill className="size-4 text-text-warning-secondary" />
                </div>
                <span className="system-xs-medium text-text-primary">
                  {t('form.upgradeHighQualityTip', { ns: 'datasetSettings' })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {indexMethod === IndexingType.QUALIFIED && (
        <div className={rowClass}>
          <div className={labelClass}>
            <div className="system-sm-semibold text-text-secondary">
              {t('form.embeddingModel', { ns: 'datasetSettings' })}
            </div>
          </div>
          <div className="grow">
            <ModelSelector
              defaultModel={embeddingModel}
              modelList={embeddingModelList}
              onSelect={setEmbeddingModel}
            />
          </div>
        </div>
      )}
      {
        indexMethod === IndexingType.QUALIFIED
        && [ChunkingMode.text, ChunkingMode.parentChild].includes(currentDataset?.doc_form as ChunkingMode)
        && (
          <>
            <Divider
              type="horizontal"
              className="my-1 h-px bg-divider-subtle"
            />
            <SummaryIndexSetting
              entry="dataset-settings"
              summaryIndexSetting={summaryIndexSetting}
              onSummaryIndexSettingChange={handleSummaryIndexSettingChange}
            />
          </>
        )
      }
      {/* Retrieval Method Config */}
      {currentDataset?.provider === 'external'
        ? (
            <>
              <Divider
                type="horizontal"
                className="my-1 h-px bg-divider-subtle"
              />
              <div className={rowClass}>
                <div className={labelClass}>
                  <div className="system-sm-semibold text-text-secondary">{t('form.retrievalSetting.title', { ns: 'datasetSettings' })}</div>
                </div>
                <RetrievalSettings
                  topK={topK}
                  scoreThreshold={scoreThreshold}
                  scoreThresholdEnabled={scoreThresholdEnabled}
                  onChange={handleSettingsChange}
                  isInRetrievalSetting={true}
                />
              </div>
              <Divider
                type="horizontal"
                className="my-1 h-px bg-divider-subtle"
              />
              <div className={rowClass}>
                <div className={labelClass}>
                  <div className="system-sm-semibold text-text-secondary">{t('form.externalKnowledgeAPI', { ns: 'datasetSettings' })}</div>
                </div>
                <div className="w-full">
                  <div className="flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2">
                    <ApiConnectionMod className="h-4 w-4 text-text-secondary" />
                    <div className="system-sm-medium overflow-hidden text-ellipsis text-text-secondary">
                      {currentDataset?.external_knowledge_info.external_knowledge_api_name}
                    </div>
                    <div className="system-xs-regular text-text-tertiary">·</div>
                    <div className="system-xs-regular text-text-tertiary">
                      {currentDataset?.external_knowledge_info.external_knowledge_api_endpoint}
                    </div>
                  </div>
                </div>
              </div>
              <div className={rowClass}>
                <div className={labelClass}>
                  <div className="system-sm-semibold text-text-secondary">{t('form.externalKnowledgeID', { ns: 'datasetSettings' })}</div>
                </div>
                <div className="w-full">
                  <div className="flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2">
                    <div className="system-xs-regular text-text-tertiary">
                      {currentDataset?.external_knowledge_info.external_knowledge_id}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )

        : indexMethod
          ? (
              <>
                <Divider
                  type="horizontal"
                  className="my-1 h-px bg-divider-subtle"
                />
                <div className={rowClass}>
                  <div className={labelClass}>
                    <div className="flex w-[180px] shrink-0 flex-col">
                      <div className="system-sm-semibold flex h-7 items-center pt-1 text-text-secondary">
                        {t('form.retrievalSetting.title', { ns: 'datasetSettings' })}
                      </div>
                      <div className="body-xs-regular text-text-tertiary">
                        <a
                          target="_blank"
                          rel="noopener noreferrer"
                          href={docLink('/use-dify/knowledge/create-knowledge/setting-indexing-methods')}
                          className="text-text-accent"
                        >
                          {t('form.retrievalSetting.learnMore', { ns: 'datasetSettings' })}
                        </a>
                        {t('form.retrievalSetting.description', { ns: 'datasetSettings' })}
                      </div>
                    </div>
                  </div>
                  <div className="grow">
                    {indexMethod === IndexingType.QUALIFIED
                      ? (
                          <RetrievalMethodConfig
                            value={retrievalConfig}
                            onChange={setRetrievalConfig}
                            showMultiModalTip={showMultiModalTip}
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
            )
          : null}
      <Divider
        type="horizontal"
        className="my-1 h-px bg-divider-subtle"
      />
      <div className={rowClass}>
        <div className={labelClass} />
        <div className="grow">
          <Button
            className="min-w-24"
            variant="primary"
            loading={loading}
            disabled={loading}
            onClick={handleSave}
          >
            {t('form.save', { ns: 'datasetSettings' })}
          </Button>
        </div>
      </div>
      {showAppIconPicker && (
        <AppIconPicker
          onSelect={handleSelectAppIcon}
          onClose={handleCloseAppIconPicker}
        />
      )}
    </div>
  )
}

export default Form
