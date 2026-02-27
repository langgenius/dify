'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useKnowledge } from '@/hooks/use-knowledge'
import { DOC_FORM_TEXT } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import AppIcon from '../../base/app-icon'
import Effect from '../../base/effect'
import Dropdown from './dropdown'

type DatasetInfoProps = {
  expand: boolean
}

const DatasetInfo: FC<DatasetInfoProps> = ({
  expand,
}) => {
  const { t } = useTranslation()
  const dataset = useDatasetDetailContextWithSelector(state => state.dataset) as DataSet
  const iconInfo = dataset.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }
  const isExternalProvider = dataset.provider === 'external'
  const isPipelinePublished = useMemo(() => {
    return dataset.runtime_mode === 'rag_pipeline' && dataset.is_published
  }, [dataset.runtime_mode, dataset.is_published])
  const { formatIndexingTechniqueAndMethod } = useKnowledge()

  return (
    <div className={cn('relative flex flex-col', expand ? '' : 'p-1')}>
      {expand && (
        <Effect className="-left-5 top-[-22px] opacity-15" />
      )}

      <div className="flex flex-col gap-2 p-2">
        <div className="flex items-center gap-1">
          <div className={cn(!expand && '-ml-1')}>
            <AppIcon
              size={expand ? 'large' : 'small'}
              iconType={iconInfo.icon_type}
              icon={iconInfo.icon}
              background={iconInfo.icon_background}
              imageUrl={iconInfo.icon_url}
            />
          </div>
          {expand && (
            <div className="ml-auto">
              <Dropdown expand />
            </div>
          )}
        </div>
        {!expand && (
          <div className="-mb-2 -mt-1 flex items-center justify-center">
            <Dropdown expand={false} />
          </div>
        )}
        {expand && (
          <div className="flex flex-col gap-y-1 pb-0.5">
            <div
              className="system-md-semibold truncate text-text-secondary"
              title={dataset.name}
            >
              {dataset.name}
            </div>
            <div className="system-2xs-medium-uppercase text-text-tertiary">
              {isExternalProvider && t('externalTag', { ns: 'dataset' })}
              {!!(!isExternalProvider && isPipelinePublished && dataset.doc_form && dataset.indexing_technique) && (
                <div className="flex items-center gap-x-2">
                  <span>{t(`chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`, { ns: 'dataset' })}</span>
                  <span>{formatIndexingTechniqueAndMethod(dataset.indexing_technique, dataset.retrieval_model_dict?.search_method)}</span>
                </div>
              )}
            </div>
            {!!dataset.description && (
              <p className="system-xs-regular line-clamp-3 text-text-tertiary first-letter:capitalize">
                {dataset.description}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(DatasetInfo)
