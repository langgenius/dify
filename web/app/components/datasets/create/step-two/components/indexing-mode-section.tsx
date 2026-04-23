'use client'

import type { FC } from 'react'
import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Divider from '@/app/components/base/divider'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useDocLink } from '@/context/i18n'
import { ChunkingMode } from '@/models/datasets'
import Link from '@/next/link'
import { indexMethodIcon } from '../../icons'
import { IndexingType } from '../hooks'
import s from '../index.module.css'
import { OptionCard } from './option-card'

type IndexingModeSectionProps = {
  // State
  indexType: IndexingType
  hasSetIndexType: boolean
  docForm: ChunkingMode
  embeddingModel: DefaultModel
  embeddingModelList?: Model[]
  retrievalConfig: RetrievalConfig
  showMultiModalTip: boolean
  // Flags
  isModelAndRetrievalConfigDisabled: boolean
  datasetId?: string
  // Modal state
  isQAConfirmDialogOpen: boolean
  // Actions
  onIndexTypeChange: (type: IndexingType) => void
  onEmbeddingModelChange: (model: DefaultModel) => void
  onRetrievalConfigChange: (config: RetrievalConfig) => void
  onQAConfirmDialogClose: () => void
  onQAConfirmDialogConfirm: () => void
}

export const IndexingModeSection: FC<IndexingModeSectionProps> = ({
  indexType,
  hasSetIndexType,
  docForm,
  embeddingModel,
  embeddingModelList,
  retrievalConfig,
  showMultiModalTip,
  isModelAndRetrievalConfigDisabled,
  datasetId,
  isQAConfirmDialogOpen,
  onIndexTypeChange,
  onEmbeddingModelChange,
  onRetrievalConfigChange,
  onQAConfirmDialogClose,
  onQAConfirmDialogConfirm,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  const getIndexingTechnique = () => indexType
  const economicalDisabledReason = (() => {
    if (docForm === ChunkingMode.qa)
      return t('stepTwo.notAvailableForQA', { ns: 'datasetCreation' })

    if (docForm !== ChunkingMode.text)
      return t('stepTwo.notAvailableForParentChild', { ns: 'datasetCreation' })
  })()

  return (
    <>
      {/* Index Mode */}
      <div className="mb-1 system-md-semibold text-text-secondary">
        {t('stepTwo.indexMode', { ns: 'datasetCreation' })}
      </div>
      <AlertDialog
        open={isQAConfirmDialogOpen}
        onOpenChange={(open) => {
          if (!open)
            onQAConfirmDialogClose()
        }}
      >
        <AlertDialogContent className="w-[432px]">
          <div className="flex flex-col gap-2 p-6 pb-4">
            <AlertDialogTitle className="text-lg leading-7 font-semibold text-text-primary">
              {t('stepTwo.qaSwitchHighQualityTipTitle', { ns: 'datasetCreation' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-5 text-text-secondary">
              {t('stepTwo.qaSwitchHighQualityTipContent', { ns: 'datasetCreation' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">
              {t('stepTwo.cancel', { ns: 'datasetCreation' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton tone="default" onClick={onQAConfirmDialogConfirm}>
              {t('stepTwo.switch', { ns: 'datasetCreation' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex items-stretch gap-2">
        {/* Qualified option */}
        {(!hasSetIndexType || (hasSetIndexType && indexType === IndexingType.QUALIFIED)) && (
          <OptionCard
            className="flex-1 self-stretch"
            title={(
              <div className="flex items-center">
                {t('stepTwo.qualified', { ns: 'datasetCreation' })}
                <Badge
                  className={cn(
                    'ml-1 h-[18px]',
                    (!hasSetIndexType && indexType === IndexingType.QUALIFIED)
                      ? 'border-text-accent-secondary text-text-accent-secondary'
                      : '',
                  )}
                  uppercase
                >
                  {t('stepTwo.recommend', { ns: 'datasetCreation' })}
                </Badge>
                <span className="ml-auto">
                  {!hasSetIndexType && <span className={cn(s.radio)} />}
                </span>
              </div>
            )}
            description={t('stepTwo.qualifiedTip', { ns: 'datasetCreation' })}
            icon={<img src={indexMethodIcon.high_quality} alt="" />}
            isActive={!hasSetIndexType && indexType === IndexingType.QUALIFIED}
            disabled={hasSetIndexType}
            onSwitched={() => onIndexTypeChange(IndexingType.QUALIFIED)}
          />
        )}

        {/* Economical option */}
        {(!hasSetIndexType || (hasSetIndexType && indexType === IndexingType.ECONOMICAL)) && (
          <OptionCard
            className="flex-1 self-stretch"
            title={t('stepTwo.economical', { ns: 'datasetCreation' })}
            description={economicalDisabledReason || t('stepTwo.economicalTip', { ns: 'datasetCreation' })}
            icon={<img src={indexMethodIcon.economical} alt="" />}
            isActive={!hasSetIndexType && indexType === IndexingType.ECONOMICAL}
            disabled={hasSetIndexType || !!economicalDisabledReason}
            onSwitched={() => onIndexTypeChange(IndexingType.ECONOMICAL)}
          />
        )}
      </div>

      {/* High quality tip */}
      {!hasSetIndexType && indexType === IndexingType.QUALIFIED && (
        <div className="mt-2 flex h-10 items-center gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs backdrop-blur-[5px]">
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-dataset-warning-message-bg opacity-40"></div>
          <div className="p-1">
            <AlertTriangle className="size-4 text-text-warning-secondary" />
          </div>
          <span className="system-xs-medium text-text-primary">
            {t('stepTwo.highQualityTip', { ns: 'datasetCreation' })}
          </span>
        </div>
      )}

      {/* Economical index setting tip */}
      {hasSetIndexType && indexType === IndexingType.ECONOMICAL && (
        <div className="mt-2 system-xs-medium text-text-tertiary">
          {t('stepTwo.indexSettingTip', { ns: 'datasetCreation' })}
          <Link className="text-text-accent" href={`/datasets/${datasetId}/settings`}>
            {t('stepTwo.datasetSettingLink', { ns: 'datasetCreation' })}
          </Link>
        </div>
      )}

      {/* Embedding model */}
      {indexType === IndexingType.QUALIFIED && (
        <div className="mt-5">
          <div className={cn('mb-1 system-md-semibold text-text-secondary', datasetId && 'flex items-center justify-between')}>
            {t('form.embeddingModel', { ns: 'datasetSettings' })}
          </div>
          <ModelSelector
            readonly={isModelAndRetrievalConfigDisabled}
            triggerClassName={isModelAndRetrievalConfigDisabled ? 'opacity-50' : ''}
            defaultModel={embeddingModel}
            modelList={embeddingModelList ?? []}
            onSelect={onEmbeddingModelChange}
          />
          {isModelAndRetrievalConfigDisabled && (
            <div className="mt-2 system-xs-medium text-text-tertiary">
              {t('stepTwo.indexSettingTip', { ns: 'datasetCreation' })}
              <Link className="text-text-accent" href={`/datasets/${datasetId}/settings`}>
                {t('stepTwo.datasetSettingLink', { ns: 'datasetCreation' })}
              </Link>
            </div>
          )}
        </div>
      )}

      <Divider className="my-5" />

      {/* Retrieval Method Config */}
      <div>
        {!isModelAndRetrievalConfigDisabled
          ? (
              <div className="mb-1">
                <div className="mb-0.5 system-md-semibold text-text-secondary">
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
                  {t('form.retrievalSetting.longDescription', { ns: 'datasetSettings' })}
                </div>
              </div>
            )
          : (
              <div className={cn('mb-0.5 system-md-semibold text-text-secondary', 'flex items-center justify-between')}>
                <div>{t('form.retrievalSetting.title', { ns: 'datasetSettings' })}</div>
              </div>
            )}

        <div>
          {getIndexingTechnique() === IndexingType.QUALIFIED
            ? (
                <RetrievalMethodConfig
                  disabled={isModelAndRetrievalConfigDisabled}
                  value={retrievalConfig}
                  onChange={onRetrievalConfigChange}
                  showMultiModalTip={showMultiModalTip}
                />
              )
            : (
                <EconomicalRetrievalMethodConfig
                  disabled={isModelAndRetrievalConfigDisabled}
                  value={retrievalConfig}
                  onChange={onRetrievalConfigChange}
                />
              )}
        </div>
      </div>
    </>
  )
}
