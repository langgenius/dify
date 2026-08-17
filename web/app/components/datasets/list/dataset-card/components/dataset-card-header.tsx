import type { DatasetCardItem } from '../types'
import type { ChunkingMode } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { useKnowledge } from '@/hooks/use-knowledge'
import { DOC_FORM_ICON_WITH_BG, DOC_FORM_TEXT } from '@/models/datasets'

const EXTERNAL_PROVIDER = 'external'
const docModeInfoClassName =
  'flex min-h-3 items-center gap-x-3 system-2xs-medium-uppercase text-text-tertiary'

const isChunkingMode = (value: string | null): value is ChunkingMode => {
  return value !== null && Object.hasOwn(DOC_FORM_TEXT, value)
}

type DatasetCardHeaderProps = {
  dataset: DatasetCardItem
}

// DocModeInfo component - placed before usage
type DocModeInfoProps = {
  dataset: DatasetCardItem
  isExternalProvider: boolean
  isShowDocModeInfo: boolean
}

const DocModeInfo = ({ dataset, isExternalProvider, isShowDocModeInfo }: DocModeInfoProps) => {
  const { t } = useTranslation()
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const isPipeline = dataset.embedding_available && dataset.runtime_mode === 'rag_pipeline'
  const docForm = isChunkingMode(dataset.doc_form) ? dataset.doc_form : null
  const retrievalSearchMethod =
    'search_method' in dataset.retrieval_model_dict
      ? dataset.retrieval_model_dict.search_method
      : undefined

  if (isExternalProvider) {
    return (
      <div className={docModeInfoClassName}>
        <span>{t(($) => $.externalKnowledgeBase, { ns: 'dataset' })}</span>
      </div>
    )
  }

  if (!isShowDocModeInfo && !isPipeline)
    return <div aria-hidden="true" className={docModeInfoClassName} />

  const indexingText = dataset.indexing_technique
    ? formatIndexingTechniqueAndMethod(
        dataset.indexing_technique as 'economy' | 'high_quality',
        retrievalSearchMethod as Parameters<typeof formatIndexingTechniqueAndMethod>[1],
      )
    : ''

  return (
    <div className={docModeInfoClassName}>
      {isPipeline && (
        <span className="max-w-full min-w-0 truncate">
          {t(($) => $['cornerLabel.pipeline'], { ns: 'dataset' })}
        </span>
      )}
      {isShowDocModeInfo && !!docForm && (
        <span
          className="max-w-full min-w-0 truncate"
          title={t(($) => $[`chunkingMode.${DOC_FORM_TEXT[docForm]}`], { ns: 'dataset' })}
        >
          {t(($) => $[`chunkingMode.${DOC_FORM_TEXT[docForm]}`], { ns: 'dataset' })}
        </span>
      )}
      {isShowDocModeInfo && dataset.indexing_technique && indexingText && (
        <span className="max-w-full min-w-0 truncate" title={indexingText}>
          {indexingText}
        </span>
      )}
      {isShowDocModeInfo && dataset.is_multimodal && (
        <span
          className="max-w-full min-w-0 truncate"
          title={t(($) => $.multimodal, { ns: 'dataset' })}
        >
          {t(($) => $.multimodal, { ns: 'dataset' })}
        </span>
      )}
    </div>
  )
}

// Main DatasetCardHeader component
const DatasetCardHeader = ({ dataset }: DatasetCardHeaderProps) => {
  const isExternalProvider = dataset.provider === EXTERNAL_PROVIDER
  const docForm = isChunkingMode(dataset.doc_form) ? dataset.doc_form : null
  const retrievalSearchMethod =
    'search_method' in dataset.retrieval_model_dict
      ? dataset.retrieval_model_dict.search_method
      : undefined

  const isShowChunkingModeIcon =
    docForm && (dataset.runtime_mode !== 'rag_pipeline' || dataset.is_published)
  const isShowDocModeInfo = Boolean(
    docForm &&
    dataset.indexing_technique &&
    retrievalSearchMethod &&
    (dataset.runtime_mode !== 'rag_pipeline' || dataset.is_published),
  )

  const chunkingModeIcon = docForm ? DOC_FORM_ICON_WITH_BG[docForm] : React.Fragment
  const Icon = isExternalProvider ? DOC_FORM_ICON_WITH_BG.external : chunkingModeIcon

  const iconInfo = useMemo(() => {
    const source = dataset.icon_info
    return {
      icon: source?.icon ?? '📙',
      icon_type: source?.icon_type === 'image' ? ('image' as const) : ('emoji' as const),
      icon_background: source?.icon_background ?? '#FFF4ED',
      icon_url: source?.icon_url ?? '',
    }
  }, [dataset.icon_info])

  return (
    <div
      className={cn(
        'flex items-center gap-x-3 px-4 pt-4 pb-2',
        !dataset.embedding_available && 'opacity-30',
      )}
    >
      <div className="relative shrink-0">
        <AppIcon
          size="large"
          iconType={iconInfo.icon_type}
          icon={iconInfo.icon}
          background={iconInfo.icon_type === 'image' ? undefined : iconInfo.icon_background}
          imageUrl={iconInfo.icon_type === 'image' ? iconInfo.icon_url : undefined}
        />
        {(isShowChunkingModeIcon || isExternalProvider) && (
          <div className="absolute -right-1 -bottom-1 z-5">
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <div className="flex grow flex-col gap-y-1 overflow-hidden py-px">
        <div className="truncate system-md-semibold text-text-secondary" title={dataset.name}>
          {dataset.name}
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
