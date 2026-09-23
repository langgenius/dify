'use client'
import type { DataSet } from '@/models/datasets'
import { Separator } from '@langgenius/dify-ui/separator'
import { useTranslation } from 'react-i18next'
import RetrievalSettings from '../../../external-knowledge-base/create/RetrievalSettings'

const rowClass = 'flex min-w-0 flex-col gap-2 @3xl/settings:flex-row @3xl/settings:gap-x-1'
const labelClass = 'flex shrink-0 flex-col pt-1 @3xl/settings:w-45'

type ExternalKnowledgeSectionProps = {
  currentDataset: DataSet
  topK: number
  scoreThreshold: number
  scoreThresholdEnabled: boolean
  handleSettingsChange: (data: {
    top_k?: number
    score_threshold?: number
    score_threshold_enabled?: boolean
  }) => void
  readonly?: boolean
}

const ExternalKnowledgeSection = ({
  currentDataset,
  topK,
  scoreThreshold,
  scoreThresholdEnabled,
  handleSettingsChange,
  readonly = false,
}: ExternalKnowledgeSectionProps) => {
  const { t } = useTranslation(['datasetSettings'])

  return (
    <>
      <Separator orientation="horizontal" className="my-1 bg-divider-subtle" />

      {/* Retrieval Settings */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">
            {t(($) => $['form.retrievalSetting.title'], { ns: 'datasetSettings' })}
          </div>
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

      <Separator orientation="horizontal" className="my-1 bg-divider-subtle" />

      {/* External Knowledge API */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">
            {t(($) => $['form.externalKnowledgeAPI'], { ns: 'datasetSettings' })}
          </div>
        </div>
        <div className="w-full min-w-0">
          <div className="flex h-full flex-wrap items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2">
            <span
              aria-hidden
              className="i-custom-vender-solid-development-api-connection-mod size-4 shrink-0 text-text-secondary"
            />
            <div className="min-w-0 system-sm-medium wrap-anywhere text-text-secondary">
              {currentDataset.external_knowledge_info.external_knowledge_api_name}
            </div>
            <div className="system-xs-regular text-text-tertiary">·</div>
            <div className="min-w-0 system-xs-regular wrap-anywhere text-text-tertiary">
              {currentDataset.external_knowledge_info.external_knowledge_api_endpoint}
            </div>
          </div>
        </div>
      </div>

      {/* External Knowledge ID */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">
            {t(($) => $['form.externalKnowledgeID'], { ns: 'datasetSettings' })}
          </div>
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
