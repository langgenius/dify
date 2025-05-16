'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '../base/app-icon'
import Effect from '../base/effect'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import type { DataSet } from '@/models/datasets'
import { DOC_FORM_ICON_WITH_BG, DOC_FORM_TEXT } from '@/models/datasets'
import { useKnowledge } from '@/hooks/use-knowledge'
import Badge from '../base/badge'
import cn from '@/utils/classnames'

type Props = {
  expand: boolean
  extraInfo?: React.ReactNode
}

const DatasetInfo: FC<Props> = ({
  expand,
  extraInfo,
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
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const chunkingModeIcon = dataset.doc_form ? DOC_FORM_ICON_WITH_BG[dataset.doc_form] : React.Fragment
  const Icon = isExternalProvider ? DOC_FORM_ICON_WITH_BG.external : chunkingModeIcon

  return (
    <div className={cn('relative flex flex-col', expand ? '' : 'p-1')}>
      {expand && (
        <>
          <Effect className='-left-5 top-[-22px] opacity-15' />
          <div className='flex flex-col gap-y-2 p-2'>
            <div className='relative w-fit'>
              <AppIcon
                size='medium'
                iconType={iconInfo.icon_type}
                icon={iconInfo.icon}
                background={iconInfo.icon_background}
                imageUrl={iconInfo.icon_url}
              />
              {(dataset.doc_form || isExternalProvider) && (
                <div className='absolute -bottom-1 -right-1 z-10'>
                  <Icon className='size-4' />
                </div>
              )}
            </div>
            <>
              <div className='flex flex-col gap-y-1'>
                <div
                  className='system-md-semibold truncate text-text-secondary'
                  title={dataset.name}
                >
                  {dataset.name}
                </div>
                <div className='system-2xs-medium-uppercase text-text-tertiary'>
                  {isExternalProvider && t('dataset.externalTag')}
                  {!isExternalProvider && dataset.doc_form && dataset.indexing_technique && (
                    <div className='flex items-center gap-x-1'>
                      <Badge>{t(`dataset.chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`)}</Badge>
                      <Badge>{formatIndexingTechniqueAndMethod(dataset.indexing_technique, dataset.retrieval_model_dict?.search_method)}</Badge>
                    </div>
                  )}
                </div>
              </div>
              <p className='system-xs-regular line-clamp-3 text-text-tertiary first-letter:capitalize'>
                {dataset.description}
              </p>
            </>
          </div>
        </>
      )}
      {!expand && (
        <AppIcon
          size='medium'
          iconType={iconInfo.icon_type}
          icon={iconInfo.icon}
          background={iconInfo.icon_background}
          imageUrl={iconInfo.icon_url}
        />
      )}
      {extraInfo}
    </div>
  )
}
export default React.memo(DatasetInfo)
