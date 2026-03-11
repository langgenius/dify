'use client'
import type { DataSet } from '@/models/datasets'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import RetrievalSettings from '../../../external-knowledge-base/create/RetrievalSettings'

const rowClass = 'flex gap-x-1'
const labelClass = 'flex items-center shrink-0 w-[180px] h-7 pt-1'

type ExternalKnowledgeSectionProps = {
  currentDataset: DataSet
  topK: number
  scoreThreshold: number
  scoreThresholdEnabled: boolean
  handleSettingsChange: (data: { top_k?: number, score_threshold?: number, score_threshold_enabled?: boolean }) => void
}

const ExternalKnowledgeSection = ({
  currentDataset,
  topK,
  scoreThreshold,
  scoreThresholdEnabled,
  handleSettingsChange,
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
            <ApiConnectionMod className="h-4 w-4 text-text-secondary" />
            <div className="system-sm-medium overflow-hidden text-ellipsis text-text-secondary">
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
          <div className="flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2">
            <div className="system-xs-regular text-text-tertiary">
              {currentDataset.external_knowledge_info.external_knowledge_id}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default ExternalKnowledgeSection
