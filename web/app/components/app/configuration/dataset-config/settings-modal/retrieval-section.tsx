import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { RiCloseLine } from '@remixicon/react'
import Divider from '@/app/components/base/divider'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import RetrievalSettings from '@/app/components/datasets/external-knowledge-base/create/RetrievalSettings'
import { cn } from '@/utils/classnames'

type CommonSectionProps = {
  rowClass: string
  labelClass: string
  t: (key: string, options?: any) => string
}

type ExternalRetrievalSectionProps = CommonSectionProps & {
  topK: number
  scoreThreshold: number
  scoreThresholdEnabled: boolean
  onExternalSettingChange: (data: { top_k?: number, score_threshold?: number, score_threshold_enabled?: boolean }) => void
  currentDataset: DataSet
}

const ExternalRetrievalSection: FC<ExternalRetrievalSectionProps> = ({
  rowClass,
  labelClass,
  t,
  topK,
  scoreThreshold,
  scoreThresholdEnabled,
  onExternalSettingChange,
  currentDataset,
}) => (
  <>
    <div className={rowClass}><Divider /></div>
    <div className={rowClass}>
      <div className={labelClass}>
        <div className="system-sm-semibold text-text-secondary">{t('form.retrievalSetting.title', { ns: 'datasetSettings' })}</div>
      </div>
      <RetrievalSettings
        topK={topK}
        scoreThreshold={scoreThreshold}
        scoreThresholdEnabled={scoreThresholdEnabled}
        onChange={onExternalSettingChange}
        isInRetrievalSetting={true}
      />
    </div>
    <div className={rowClass}><Divider /></div>
    <div className={rowClass}>
      <div className={labelClass}>
        <div className="system-sm-semibold text-text-secondary">{t('form.externalKnowledgeAPI', { ns: 'datasetSettings' })}</div>
      </div>
      <div className="w-full max-w-[480px]">
        <div className="flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2">
          <ApiConnectionMod className="h-4 w-4 text-text-secondary" />
          <div className="system-sm-medium overflow-hidden text-ellipsis text-text-secondary">
            {currentDataset?.external_knowledge_info.external_knowledge_api_name}
          </div>
          <div className="system-xs-regular text-text-tertiary">·</div>
          <div className="system-xs-regular text-text-tertiary">{currentDataset?.external_knowledge_info.external_knowledge_api_endpoint}</div>
        </div>
      </div>
    </div>
    <div className={rowClass}>
      <div className={labelClass}>
        <div className="system-sm-semibold text-text-secondary">{t('form.externalKnowledgeID', { ns: 'datasetSettings' })}</div>
      </div>
      <div className="w-full max-w-[480px]">
        <div className="flex h-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-3 py-2">
          <div className="system-xs-regular text-text-tertiary">{currentDataset?.external_knowledge_info.external_knowledge_id}</div>
        </div>
      </div>
    </div>
    <div className={rowClass}><Divider /></div>
  </>
)

type InternalRetrievalSectionProps = CommonSectionProps & {
  indexMethod: IndexingType
  retrievalConfig: RetrievalConfig
  showMultiModalTip: boolean
  onRetrievalConfigChange: (value: RetrievalConfig) => void
  docLink: (path?: DocPathWithoutLang) => string
}

const InternalRetrievalSection: FC<InternalRetrievalSectionProps> = ({
  rowClass,
  labelClass,
  t,
  indexMethod,
  retrievalConfig,
  showMultiModalTip,
  onRetrievalConfigChange,
  docLink,
}) => (
  <div className={rowClass}>
    <div className={cn(labelClass, 'w-auto min-w-[168px]')}>
      <div>
        <div className="system-sm-semibold text-text-secondary">{t('form.retrievalSetting.title', { ns: 'datasetSettings' })}</div>
        <div className="text-xs font-normal leading-[18px] text-text-tertiary">
          <a target="_blank" rel="noopener noreferrer" href={docLink('/use-dify/knowledge/create-knowledge/setting-indexing-methods')} className="text-text-accent">{t('form.retrievalSetting.learnMore', { ns: 'datasetSettings' })}</a>
          {t('form.retrievalSetting.description', { ns: 'datasetSettings' })}
        </div>
      </div>
    </div>
    <div>
      {indexMethod === IndexingType.QUALIFIED
        ? (
            <RetrievalMethodConfig
              value={retrievalConfig}
              onChange={onRetrievalConfigChange}
              showMultiModalTip={showMultiModalTip}
            />
          )
        : (
            <EconomicalRetrievalMethodConfig
              value={retrievalConfig}
              onChange={onRetrievalConfigChange}
            />
          )}
    </div>
  </div>
)

type RetrievalSectionProps
  = | (ExternalRetrievalSectionProps & { isExternal: true })
    | (InternalRetrievalSectionProps & { isExternal: false })

export const RetrievalSection: FC<RetrievalSectionProps> = (props) => {
  if (props.isExternal) {
    const {
      rowClass,
      labelClass,
      t,
      topK,
      scoreThreshold,
      scoreThresholdEnabled,
      onExternalSettingChange,
      currentDataset,
    } = props

    return (
      <ExternalRetrievalSection
        rowClass={rowClass}
        labelClass={labelClass}
        t={t}
        topK={topK}
        scoreThreshold={scoreThreshold}
        scoreThresholdEnabled={scoreThresholdEnabled}
        onExternalSettingChange={onExternalSettingChange}
        currentDataset={currentDataset}
      />
    )
  }

  const {
    rowClass,
    labelClass,
    t,
    indexMethod,
    retrievalConfig,
    showMultiModalTip,
    onRetrievalConfigChange,
    docLink,
  } = props

  return (
    <InternalRetrievalSection
      rowClass={rowClass}
      labelClass={labelClass}
      t={t}
      indexMethod={indexMethod}
      retrievalConfig={retrievalConfig}
      showMultiModalTip={showMultiModalTip}
      onRetrievalConfigChange={onRetrievalConfigChange}
      docLink={docLink}
    />
  )
}

type RetrievalChangeTipProps = {
  visible: boolean
  message: string
  onDismiss: () => void
}

export const RetrievalChangeTip: FC<RetrievalChangeTipProps> = ({
  visible,
  message,
  onDismiss,
}) => {
  if (!visible)
    return null

  return (
    <div className="absolute bottom-[76px] left-[30px] right-[30px] z-10 flex h-10 items-center justify-between rounded-lg border border-[#FEF0C7] bg-[#FFFAEB] px-3 shadow-lg">
      <div className="flex items-center">
        <AlertTriangle className="mr-1 h-3 w-3 text-[#F79009]" />
        <div className="text-xs font-medium leading-[18px] text-gray-700">{message}</div>
      </div>
      <button
        type="button"
        className="cursor-pointer p-1"
        onClick={(event) => {
          onDismiss()
          event.stopPropagation()
        }}
        aria-label="close-retrieval-change-tip"
      >
        <RiCloseLine className="h-4 w-4 text-gray-500" />
      </button>
    </div>
  )
}
