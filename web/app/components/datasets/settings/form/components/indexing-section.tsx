'use client'
import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DataSet, SummaryIndexSetting as SummaryIndexSettingType } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { RiAlertFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { IS_CE_EDITION } from '@/config'
import { useDocLink } from '@/context/i18n'
import { ChunkingMode } from '@/models/datasets'
import { IndexingType } from '../../../create/step-two'
import ChunkStructure from '../../chunk-structure'
import IndexMethod from '../../index-method'
import SummaryIndexSetting from '../../summary-index-setting'

const rowClass = 'flex gap-x-1'
const labelClass = 'flex items-center shrink-0 w-[180px] h-7 pt-1'

type IndexingSectionProps = {
  currentDataset: DataSet | undefined
  indexMethod: IndexingType | undefined
  setIndexMethod: (value: IndexingType | undefined) => void
  keywordNumber: number
  setKeywordNumber: (value: number) => void
  embeddingModel: DefaultModel
  setEmbeddingModel: (value: DefaultModel) => void
  embeddingModelList: Model[]
  retrievalConfig: RetrievalConfig
  setRetrievalConfig: (value: RetrievalConfig) => void
  summaryIndexSetting: SummaryIndexSettingType | undefined
  handleSummaryIndexSettingChange: (payload: SummaryIndexSettingType) => void
  showMultiModalTip: boolean
}

const IndexingSection = ({
  currentDataset,
  indexMethod,
  setIndexMethod,
  keywordNumber,
  setKeywordNumber,
  embeddingModel,
  setEmbeddingModel,
  embeddingModelList,
  retrievalConfig,
  setRetrievalConfig,
  summaryIndexSetting,
  handleSummaryIndexSettingChange,
  showMultiModalTip,
}: IndexingSectionProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  const isShowIndexMethod = currentDataset
    && currentDataset.doc_form !== ChunkingMode.parentChild
    && currentDataset.indexing_technique
    && indexMethod

  const showUpgradeWarning = currentDataset?.indexing_technique === IndexingType.ECONOMICAL
    && indexMethod === IndexingType.QUALIFIED

  const showSummaryIndexSetting = indexMethod === IndexingType.QUALIFIED
    && [ChunkingMode.text, ChunkingMode.parentChild].includes(currentDataset?.doc_form as ChunkingMode)
    && IS_CE_EDITION

  return (
    <>
      {/* Chunk Structure */}
      {!!currentDataset?.doc_form && (
        <>
          <Divider type="horizontal" className="my-1 h-px bg-divider-subtle" />
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
              <ChunkStructure chunkStructure={currentDataset?.doc_form} />
            </div>
          </div>
        </>
      )}

      {!!(isShowIndexMethod || indexMethod === 'high_quality') && (
        <Divider type="horizontal" className="my-1 h-px bg-divider-subtle" />
      )}

      {/* Index Method */}
      {!!isShowIndexMethod && (
        <div className={rowClass}>
          <div className={labelClass}>
            <div className="system-sm-semibold text-text-secondary">{t('form.indexMethod', { ns: 'datasetSettings' })}</div>
          </div>
          <div className="grow">
            <IndexMethod
              value={indexMethod!}
              disabled={!currentDataset?.embedding_available}
              onChange={setIndexMethod}
              currentValue={currentDataset.indexing_technique}
              keywordNumber={keywordNumber}
              onKeywordNumberChange={setKeywordNumber}
            />
            {showUpgradeWarning && (
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

      {/* Embedding Model */}
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

      {/* Summary Index Setting */}
      {showSummaryIndexSetting && (
        <>
          <Divider type="horizontal" className="my-1 h-px bg-divider-subtle" />
          <SummaryIndexSetting
            entry="dataset-settings"
            summaryIndexSetting={summaryIndexSetting}
            onSummaryIndexSettingChange={handleSummaryIndexSettingChange}
          />
        </>
      )}

      {/* Retrieval Method Config */}
      {indexMethod && currentDataset?.provider !== 'external' && (
        <>
          <Divider type="horizontal" className="my-1 h-px bg-divider-subtle" />
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
      )}
    </>
  )
}

export default IndexingSection
