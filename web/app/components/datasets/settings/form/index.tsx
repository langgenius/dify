'use client'
import { useCallback, useRef, useState } from 'react'
import { useMount } from 'ahooks'
import { useTranslation } from 'react-i18next'
import PermissionSelector from '../permission-selector'
import IndexMethod from '../index-method'
import RetrievalSettings from '../../external-knowledge-base/create/RetrievalSettings'
import { IndexingType } from '../../create/step-two'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import { updateDatasetSetting } from '@/service/datasets'
import type { IconInfo } from '@/models/datasets'
import { ChunkingMode, DatasetPermission } from '@/models/datasets'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import type { AppIconType, RetrievalConfig } from '@/types/app'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
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
import AppIcon from '@/app/components/base/app-icon'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Divider from '@/app/components/base/divider'
import ChunkStructure from '../chunk-structure'
import Toast from '@/app/components/base/toast'
import { RiAlertFill } from '@remixicon/react'
import { useDocLink } from '@/context/i18n'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'

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
  const {
    modelList: rerankModelList,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const previousAppIcon = useRef(DEFAULT_APP_ICON)

  const getMembers = async () => {
    const { accounts } = await fetchMembers({ url: '/workspaces/current/members', params: {} })
    if (!accounts)
      setMemberList([])
    else
      setMemberList(accounts)
  }

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

  const handleSettingsChange = useCallback((data: { top_k?: number; score_threshold?: number; score_threshold_enabled?: boolean }) => {
    if (data.top_k !== undefined)
      setTopK(data.top_k)
    if (data.score_threshold !== undefined)
      setScoreThreshold(data.score_threshold)
    if (data.score_threshold_enabled !== undefined)
      setScoreThresholdEnabled(data.score_threshold_enabled)
  }, [])

  useMount(() => {
    getMembers()
  })

  const invalidDatasetList = useInvalidDatasetList()
  const handleSave = async () => {
    if (loading)
      return
    if (!name?.trim()) {
      Toast.notify({ type: 'error', message: t('datasetSettings.form.nameError') })
      return
    }
    if (
      !isReRankModelSelected({
        rerankModelList,
        retrievalConfig,
        indexMethod,
      })
    ) {
      Toast.notify({ type: 'error', message: t('appDebug.datasetConfig.rerankModelRequired') })
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
      Toast.notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      if (mutateDatasets) {
        await mutateDatasets()
        invalidDatasetList()
      }
    }
    catch {
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
    finally {
      setLoading(false)
    }
  }

  const isShowIndexMethod = currentDataset && currentDataset.doc_form !== ChunkingMode.parentChild && currentDataset.indexing_technique && indexMethod

  return (
    <div className='flex w-full flex-col gap-y-4 px-20 py-8 sm:w-[960px]'>
      {/* Dataset name and icon */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.nameAndIcon')}</div>
        </div>
        <div className='flex grow items-center gap-x-2'>
          <AppIcon
            size='small'
            onClick={handleOpenAppIconPicker}
            className='cursor-pointer'
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
          <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.desc')}</div>
        </div>
        <div className='grow'>
          <Textarea
            disabled={!currentDataset?.embedding_available}
            className='resize-none'
            placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
      </div>
      {/* Permissions */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.permissions')}</div>
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
      {
        currentDataset?.doc_form && (
          <>
            <Divider
              type='horizontal'
              className='my-1 h-px bg-divider-subtle'
            />
            {/* Chunk Structure */}
            <div className={rowClass}>
              <div className='flex w-[180px] shrink-0 flex-col'>
                <div className='system-sm-semibold flex h-8 items-center text-text-secondary'>
                  {t('datasetSettings.form.chunkStructure.title')}
                </div>
                <div className='body-xs-regular text-text-tertiary'>
                  <a
                    target='_blank'
                    rel='noopener noreferrer'
                    href={docLink('/guides/knowledge-base/create-knowledge-and-upload-documents/chunking-and-cleaning-text')}
                    className='text-text-accent'
                  >
                    {t('datasetSettings.form.chunkStructure.learnMore')}
                  </a>
                  {t('datasetSettings.form.chunkStructure.description')}
                </div>
              </div>
              <div className='grow'>
                <ChunkStructure
                  chunkStructure={currentDataset?.doc_form}
                />
              </div>
            </div>
          </>
        )
      }
      {(isShowIndexMethod || indexMethod === 'high_quality') && (
        <Divider
          type='horizontal'
          className='my-1 h-px bg-divider-subtle'
        />
      )}
      {isShowIndexMethod && (
        <div className={rowClass}>
          <div className={labelClass}>
            <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.indexMethod')}</div>
          </div>
          <div className='grow'>
            <IndexMethod
              value={indexMethod}
              disabled={!currentDataset?.embedding_available}
              onChange={v => setIndexMethod(v!)}
              currentValue={currentDataset.indexing_technique}
              keywordNumber={keywordNumber}
              onKeywordNumberChange={setKeywordNumber}
            />
            {currentDataset.indexing_technique === IndexingType.ECONOMICAL && indexMethod === IndexingType.QUALIFIED && (
              <div className='relative mt-2 flex h-10 items-center gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-2 shadow-xs shadow-shadow-shadow-3'>
                <div className='absolute left-0 top-0 flex h-full w-full items-center bg-toast-warning-bg opacity-40' />
                <div className='p-1'>
                  <RiAlertFill className='size-4 text-text-warning-secondary' />
                </div>
                <span className='system-xs-medium text-text-primary'>
                  {t('datasetSettings.form.upgradeHighQualityTip')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {indexMethod === IndexingType.QUALIFIED && (
        <div className={rowClass}>
          <div className={labelClass}>
            <div className='system-sm-semibold text-text-secondary'>
              {t('datasetSettings.form.embeddingModel')}
            </div>
          </div>
          <div className='grow'>
            <ModelSelector
              defaultModel={embeddingModel}
              modelList={embeddingModelList}
              onSelect={setEmbeddingModel}
            />
          </div>
        </div>
      )}
      {/* Retrieval Method Config */}
      {currentDataset?.provider === 'external'
        ? (
          <>
            <Divider
              type='horizontal'
              className='my-1 h-px bg-divider-subtle'
            />
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
            <Divider
              type='horizontal'
              className='my-1 h-px bg-divider-subtle'
            />
            <div className={rowClass}>
              <div className={labelClass}>
                <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.externalKnowledgeAPI')}</div>
              </div>
              <div className='w-full'>
                <div className='flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2'>
                  <ApiConnectionMod className='h-4 w-4 text-text-secondary' />
                  <div className='system-sm-medium overflow-hidden text-ellipsis text-text-secondary'>
                    {currentDataset?.external_knowledge_info.external_knowledge_api_name}
                  </div>
                  <div className='system-xs-regular text-text-tertiary'>·</div>
                  <div className='system-xs-regular text-text-tertiary'>
                    {currentDataset?.external_knowledge_info.external_knowledge_api_endpoint}
                  </div>
                </div>
              </div>
            </div>
            <div className={rowClass}>
              <div className={labelClass}>
                <div className='system-sm-semibold text-text-secondary'>{t('datasetSettings.form.externalKnowledgeID')}</div>
              </div>
              <div className='w-full'>
                <div className='flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2'>
                  <div className='system-xs-regular text-text-tertiary'>
                    {currentDataset?.external_knowledge_info.external_knowledge_id}
                  </div>
                </div>
              </div>
            </div>
          </>
        )
        // eslint-disable-next-line sonarjs/no-nested-conditional
        : indexMethod
          ? (
            <>
              <Divider
                type='horizontal'
                className='my-1 h-px bg-divider-subtle'
              />
              <div className={rowClass}>
                <div className={labelClass}>
                  <div className='flex w-[180px] shrink-0 flex-col'>
                    <div className='system-sm-semibold flex h-7 items-center pt-1 text-text-secondary'>
                      {t('datasetSettings.form.retrievalSetting.title')}
                    </div>
                    <div className='body-xs-regular text-text-tertiary'>
                      <a
                        target='_blank'
                        rel='noopener noreferrer'
                        href={docLink('/guides/knowledge-base/create-knowledge-and-upload-documents/setting-indexing-methods#setting-the-retrieval-setting', {
                          'zh-Hans': '/guides/knowledge-base/create-knowledge-and-upload-documents/setting-indexing-methods#指定检索方式',
                          'ja-JP': '/guides/knowledge-base/create-knowledge-and-upload-documents/setting-indexing-methods#検索方法の指定',
                        })}
                        className='text-text-accent'
                      >
                        {t('datasetSettings.form.retrievalSetting.learnMore')}
                      </a>
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
          )
          : null
      }
      <Divider
        type='horizontal'
        className='my-1 h-px bg-divider-subtle'
      />
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
