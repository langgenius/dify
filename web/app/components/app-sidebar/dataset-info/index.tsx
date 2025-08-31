'use client'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '../../base/app-icon'
import Effect from '../../base/effect'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import type { DataSet } from '@/models/datasets'
import { DOC_FORM_TEXT } from '@/models/datasets'
import { useKnowledge } from '@/hooks/use-knowledge'
import cn from '@/utils/classnames'
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
        <>
          <Effect className='-left-5 top-[-22px] opacity-15' />
          <div className='flex flex-col gap-y-2 p-2'>
            <div className='flex items-center justify-between'>
              <AppIcon
                size='medium'
                iconType={iconInfo.icon_type}
                icon={iconInfo.icon}
                background={iconInfo.icon_background}
                imageUrl={iconInfo.icon_url}
              />
              <Dropdown expand />
            </div>
            <div className='flex flex-col gap-y-1 pb-0.5'>
              <div
                className='system-md-semibold truncate text-text-secondary'
                title={dataset.name}
              >
                {dataset.name}
              </div>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>
                {isExternalProvider && t('dataset.externalTag')}
                {!isExternalProvider && isPipelinePublished && dataset.doc_form && dataset.indexing_technique && (
                  <div className='flex items-center gap-x-2'>
                    <span>{t(`dataset.chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`)}</span>
                    <span>{formatIndexingTechniqueAndMethod(dataset.indexing_technique, dataset.retrieval_model_dict?.search_method)}</span>
                  </div>
                )}
              </div>
            </div>
            {!!dataset.description && (
              <p className='system-xs-regular line-clamp-3 text-text-tertiary first-letter:capitalize'>
                {dataset.description}
              </p>
            )}
          </div>
        </>
      )}
      {!expand && (
        <div className='flex flex-col items-center gap-y-1'>
          <AppIcon
            size='medium'
            iconType={iconInfo.icon_type}
            icon={iconInfo.icon}
            background={iconInfo.icon_background}
            imageUrl={iconInfo.icon_url}
          />
          <Dropdown expand={false} />
        </div>
      )}
    </div>
  )
}
export default React.memo(DatasetInfo)
