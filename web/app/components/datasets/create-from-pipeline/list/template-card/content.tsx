import AppIcon from '@/app/components/base/app-icon'
import { General } from '@/app/components/base/icons/src/public/knowledge/dataset-card'
import type { ChunkingMode, IconInfo } from '@/models/datasets'
import { DOC_FORM_ICON_WITH_BG, DOC_FORM_TEXT } from '@/models/datasets'
import React from 'react'
import { useTranslation } from 'react-i18next'

type ContentProps = {
  name: string
  description: string
  iconInfo: IconInfo
  chunkStructure: ChunkingMode
}

const Content = ({
  name,
  description,
  iconInfo,
  chunkStructure,
}: ContentProps) => {
  const { t } = useTranslation()
  const Icon = DOC_FORM_ICON_WITH_BG[chunkStructure] || General

  return (
    <>
      <div className='flex items-center gap-x-3 p-4 pb-2'>
        <div className='relative shrink-0'>
          <AppIcon
            size='large'
            iconType={iconInfo.icon_type}
            icon={iconInfo.icon}
            background={iconInfo.icon_type === 'image' ? undefined : iconInfo.icon_background}
            imageUrl={iconInfo.icon_type === 'image' ? iconInfo.icon_url : undefined}
          />
          <div className='absolute -bottom-1 -right-1 z-10'>
            <Icon className='size-4' />
          </div>
        </div>
        <div className='flex grow flex-col gap-y-1 overflow-hidden py-px'>
          <div
            className='system-md-semibold truncate text-text-secondary'
            title={name}
          >
            {name}
          </div>
          <div className='system-2xs-medium-uppercase text-text-tertiary'>
            {t(`dataset.chunkingMode.${DOC_FORM_TEXT[chunkStructure]}`)}
          </div>
        </div>
      </div>
      <p
        className='system-xs-regular line-clamp-3 grow px-4 py-1 text-text-tertiary'
        title={description}
      >
        {description}
      </p>
    </>
  )
}

export default React.memo(Content)
