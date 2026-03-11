import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useKnowledge } from '@/hooks/use-knowledge'
import { DOC_FORM_ICON_WITH_BG, DOC_FORM_TEXT } from '@/models/datasets'
import { cn } from '@/utils/classnames'

const EXTERNAL_PROVIDER = 'external'

type DatasetCardHeaderProps = {
  dataset: DataSet
}

// DocModeInfo component - placed before usage
type DocModeInfoProps = {
  dataset: DataSet
  isExternalProvider: boolean
  isShowDocModeInfo: boolean
}

const DocModeInfo = ({
  dataset,
  isExternalProvider,
  isShowDocModeInfo,
}: DocModeInfoProps) => {
  const { t } = useTranslation()
  const { formatIndexingTechniqueAndMethod } = useKnowledge()

  if (isExternalProvider) {
    return (
      <div className="system-2xs-medium-uppercase flex items-center gap-x-3 text-text-tertiary">
        <span>{t('externalKnowledgeBase', { ns: 'dataset' })}</span>
      </div>
    )
  }

  if (!isShowDocModeInfo)
    return null

  const indexingText = dataset.indexing_technique
    ? formatIndexingTechniqueAndMethod(
        dataset.indexing_technique as 'economy' | 'high_quality',
        dataset.retrieval_model_dict?.search_method as Parameters<typeof formatIndexingTechniqueAndMethod>[1],
      )
    : ''

  return (
    <div className="system-2xs-medium-uppercase flex items-center gap-x-3 text-text-tertiary">
      {!!dataset.doc_form && (
        <span
          className="min-w-0 max-w-full truncate"
          title={t(`chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`, { ns: 'dataset' })}
        >
          {t(`chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`, { ns: 'dataset' })}
        </span>
      )}
      {dataset.indexing_technique && indexingText && (
        <span
          className="min-w-0 max-w-full truncate"
          title={indexingText}
        >
          {indexingText}
        </span>
      )}
      {dataset.is_multimodal && (
        <span
          className="min-w-0 max-w-full truncate"
          title={t('multimodal', { ns: 'dataset' })}
        >
          {t('multimodal', { ns: 'dataset' })}
        </span>
      )}
    </div>
  )
}

// Main DatasetCardHeader component
const DatasetCardHeader = ({ dataset }: DatasetCardHeaderProps) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const isExternalProvider = dataset.provider === EXTERNAL_PROVIDER

  const isShowChunkingModeIcon = dataset.doc_form && (dataset.runtime_mode !== 'rag_pipeline' || dataset.is_published)
  const isShowDocModeInfo = Boolean(
    dataset.doc_form
    && dataset.indexing_technique
    && dataset.retrieval_model_dict?.search_method
    && (dataset.runtime_mode !== 'rag_pipeline' || dataset.is_published),
  )

  const chunkingModeIcon = dataset.doc_form ? DOC_FORM_ICON_WITH_BG[dataset.doc_form] : React.Fragment
  const Icon = isExternalProvider ? DOC_FORM_ICON_WITH_BG.external : chunkingModeIcon

  const iconInfo = useMemo(() => dataset.icon_info || {
    icon: '📙',
    icon_type: 'emoji' as const,
    icon_background: '#FFF4ED',
    icon_url: '',
  }, [dataset.icon_info])

  const editTimeText = useMemo(
    () => `${t('segment.editedAt', { ns: 'datasetDocuments' })} ${formatTimeFromNow(dataset.updated_at * 1000)}`,
    [t, dataset.updated_at, formatTimeFromNow],
  )

  return (
    <div className={cn('flex items-center gap-x-3 px-4 pb-2 pt-4', !dataset.embedding_available && 'opacity-30')}>
      <div className="relative shrink-0">
        <AppIcon
          size="large"
          iconType={iconInfo.icon_type}
          icon={iconInfo.icon}
          background={iconInfo.icon_type === 'image' ? undefined : iconInfo.icon_background}
          imageUrl={iconInfo.icon_type === 'image' ? iconInfo.icon_url : undefined}
        />
        {(isShowChunkingModeIcon || isExternalProvider) && (
          <div className="absolute -bottom-1 -right-1 z-[5]">
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <div className="flex grow flex-col gap-y-1 overflow-hidden py-px">
        <div
          className="system-md-semibold truncate text-text-secondary"
          title={dataset.name}
        >
          {dataset.name}
        </div>
        <div className="flex items-center gap-1 text-[10px] font-medium leading-[18px] text-text-tertiary">
          <div className="truncate" title={dataset.author_name}>{dataset.author_name}</div>
          <div>·</div>
          <div className="truncate" title={editTimeText}>{editTimeText}</div>
        </div>
        <DocModeInfo
          dataset={dataset}
          isExternalProvider={isExternalProvider}
          isShowDocModeInfo={isShowDocModeInfo}
        />
      </div>
    </div>
  )
}

export default React.memo(DatasetCardHeader)
