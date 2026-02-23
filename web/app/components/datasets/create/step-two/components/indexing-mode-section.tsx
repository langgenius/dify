'use client'

import type { FC } from 'react'
import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import Image from 'next/image'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import CustomDialog from '@/app/components/base/dialog'
import Divider from '@/app/components/base/divider'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useDocLink } from '@/context/i18n'
import { ChunkingMode } from '@/models/datasets'
import { cn } from '@/utils/classnames'
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

  return (
    <>
      {/* Index Mode */}
      <div className="system-md-semibold mb-1 text-text-secondary">
        {t('stepTwo.indexMode', { ns: 'datasetCreation' })}
      </div>
      <div className="flex items-center gap-2">
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
            icon={<Image src={indexMethodIcon.high_quality} alt="" />}
            isActive={!hasSetIndexType && indexType === IndexingType.QUALIFIED}
            disabled={hasSetIndexType}
            onSwitched={() => onIndexTypeChange(IndexingType.QUALIFIED)}
          />
        )}

        {/* Economical option */}
        {(!hasSetIndexType || (hasSetIndexType && indexType === IndexingType.ECONOMICAL)) && (
          <>
            <CustomDialog show={isQAConfirmDialogOpen} onClose={onQAConfirmDialogClose} className="w-[432px]">
              <header className="mb-4 pt-6">
                <h2 className="text-lg font-semibold text-text-primary">
                  {t('stepTwo.qaSwitchHighQualityTipTitle', { ns: 'datasetCreation' })}
                </h2>
                <p className="mt-2 text-sm font-normal text-text-secondary">
                  {t('stepTwo.qaSwitchHighQualityTipContent', { ns: 'datasetCreation' })}
                </p>
              </header>
              <div className="flex gap-2 pb-6">
                <Button className="ml-auto" onClick={onQAConfirmDialogClose}>
                  {t('stepTwo.cancel', { ns: 'datasetCreation' })}
                </Button>
                <Button variant="primary" onClick={onQAConfirmDialogConfirm}>
                  {t('stepTwo.switch', { ns: 'datasetCreation' })}
                </Button>
              </div>
            </CustomDialog>
            <Tooltip
              popupContent={(
                <div className="rounded-lg border-components-panel-border bg-components-tooltip-bg p-3 text-xs font-medium text-text-secondary shadow-lg">
                  {docForm === ChunkingMode.qa
                    ? t('stepTwo.notAvailableForQA', { ns: 'datasetCreation' })
                    : t('stepTwo.notAvailableForParentChild', { ns: 'datasetCreation' })}
                </div>
              )}
              noDecoration
              position="top"
              asChild={false}
              triggerClassName="flex-1 self-stretch"
            >
              <OptionCard
                className="h-full"
                title={t('stepTwo.economical', { ns: 'datasetCreation' })}
                description={t('stepTwo.economicalTip', { ns: 'datasetCreation' })}
                icon={<Image src={indexMethodIcon.economical} alt="" />}
                isActive={!hasSetIndexType && indexType === IndexingType.ECONOMICAL}
                disabled={hasSetIndexType || docForm !== ChunkingMode.text}
                onSwitched={() => onIndexTypeChange(IndexingType.ECONOMICAL)}
              />
            </Tooltip>
          </>
        )}
      </div>

      {/* High quality tip */}
      {!hasSetIndexType && indexType === IndexingType.QUALIFIED && (
        <div className="mt-2 flex h-10 items-center gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs backdrop-blur-[5px]">
          <div className="absolute bottom-0 left-0 right-0 top-0 bg-dataset-warning-message-bg opacity-40"></div>
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
        <div className="system-xs-medium mt-2 text-text-tertiary">
          {t('stepTwo.indexSettingTip', { ns: 'datasetCreation' })}
          <Link className="text-text-accent" href={`/datasets/${datasetId}/settings`}>
            {t('stepTwo.datasetSettingLink', { ns: 'datasetCreation' })}
          </Link>
        </div>
      )}

      {/* Embedding model */}
      {indexType === IndexingType.QUALIFIED && (
        <div className="mt-5">
          <div className={cn('system-md-semibold mb-1 text-text-secondary', datasetId && 'flex items-center justify-between')}>
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
            <div className="system-xs-medium mt-2 text-text-tertiary">
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
                <div className="system-md-semibold mb-0.5 text-text-secondary">
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
              <div className={cn('system-md-semibold mb-0.5 text-text-secondary', 'flex items-center justify-between')}>
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
