'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '../base/app-icon'
import Effect from '../base/effect'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DOC_FORM_ICON_WITH_BG, DOC_FORM_TEXT } from '@/models/datasets'
import { useKnowledge } from '@/hooks/use-knowledge'
import Badge from '../base/badge'

type Props = {
  expand: boolean
  extraInfo?: React.ReactNode
}

const DatasetInfo: FC<Props> = ({
  expand,
  extraInfo,
}) => {
  const { t } = useTranslation()
  const dataset = useDatasetDetailContextWithSelector(state => state.dataset)
  const iconInfo = dataset!.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }
  const isExternal = dataset!.provider === 'external'
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const Icon = isExternal ? DOC_FORM_ICON_WITH_BG.external : DOC_FORM_ICON_WITH_BG[dataset!.doc_form]

  return (
    <div className='relative flex flex-col p-2'>
      <Effect className='-left-5 top-[-22px] opacity-15' />
      <div className='flex flex-col gap-y-2 p-2'>
        <div className='relative w-fit'>
          <AppIcon
            size='large'
            iconType={iconInfo.icon_type}
            icon={iconInfo.icon}
            background={iconInfo.icon_background}
            imageUrl={iconInfo.icon_url}
          />
          <div className='absolute -bottom-1 -right-1 z-10'>
            <Icon className='size-4' />
          </div>
        </div>
        {expand && dataset && (
          <>
            <div className='flex flex-col gap-y-1'>
              <div
                className='system-md-semibold truncate text-text-secondary'
                title={dataset.name}
              >
                {dataset.name}
              </div>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>
                {isExternal && t('dataset.externalTag')}
                {!isExternal && (
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
        )}
      </div>
      {extraInfo}
    </div>
  )
}
export default React.memo(DatasetInfo)
