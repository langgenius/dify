'use client'
import type { DataSet } from '@/models/datasets'
import { Input } from '@langgenius/dify-ui/input'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import RetrievalSettings from '../../../external-knowledge-base/create/RetrievalSettings'

const rowClass = 'flex gap-x-1'
const labelClass = 'flex items-center shrink-0 w-[180px] h-7 pt-1'

type ExternalKnowledgeSectionProps = {
  currentDataset: DataSet
  externalKnowledgeId: string
  setExternalKnowledgeId: (value: string) => void
  topK: number
  scoreThreshold: number
  scoreThresholdEnabled: boolean
  handleSettingsChange: (data: { top_k?: number, score_threshold?: number, score_threshold_enabled?: boolean }) => void
  readonly?: boolean
}

const ExternalKnowledgeSection = ({
  currentDataset,
  externalKnowledgeId,
  setExternalKnowledgeId,
  topK,
  scoreThreshold,
  scoreThresholdEnabled,
  handleSettingsChange,
  readonly = false,
}: ExternalKnowledgeSectionProps) => {
  const { t } = useTranslation()

  return (
    <>
      <Divider type="horizontal" className="my-1 h-px bg-divider-subtle" />

      {/* Retrieval Settings */}
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
          readonly={readonly}
        />
      </div>

      <Divider type="horizontal" className="my-1 h-px bg-divider-subtle" />

      {/* External Knowledge API */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">{t('form.externalKnowledgeAPI', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="w-full">
          <div className="flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2">
            <span aria-hidden className="i-custom-vender-solid-development-api-connection-mod size-4 text-text-secondary" />
            <div className="overflow-hidden system-sm-medium text-ellipsis text-text-secondary">
              {currentDataset.external_knowledge_info.external_knowledge_api_name}
            </div>
            <div className="system-xs-regular text-text-tertiary">·</div>
            <div className="system-xs-regular text-text-tertiary">
              {currentDataset.external_knowledge_info.external_knowledge_api_endpoint}
            </div>
          </div>
        </div>
      </div>

      {/* External Knowledge ID */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">{t('form.externalKnowledgeID', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="w-full">
          <Input
            aria-label={t('form.externalKnowledgeID', { ns: 'datasetSettings' })}
            disabled={!currentDataset.embedding_available}
            value={externalKnowledgeId}
            onChange={e => setExternalKnowledgeId(e.target.value)}
            placeholder={t('externalKnowledgeIdPlaceholder', { ns: 'dataset' }) ?? ''}
          />
        </div>
      </div>
    </>
  )
}

export default ExternalKnowledgeSection
