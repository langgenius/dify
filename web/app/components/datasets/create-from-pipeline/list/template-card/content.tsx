import type { ChunkingMode, IconInfo } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { DOC_FORM_ICON_CLASS_WITH_BG, DOC_FORM_TEXT } from '@/models/datasets'

type ContentProps = {
  name: string
  description: string
  iconInfo: IconInfo
  chunkStructure: ChunkingMode
}

const Content = ({ name, description, iconInfo, chunkStructure }: ContentProps) => {
  const { t } = useTranslation()
  const iconClassName =
    DOC_FORM_ICON_CLASS_WITH_BG[chunkStructure] || 'i-custom-public-knowledge-dataset-card-general'

  return (
    <>
      <div className="flex items-center gap-x-3 p-4 pb-2">
        <div className="relative shrink-0">
          <AppIcon
            size="large"
            iconType={iconInfo.icon_type}
            icon={iconInfo.icon}
            background={iconInfo.icon_type === 'image' ? undefined : iconInfo.icon_background}
            imageUrl={iconInfo.icon_type === 'image' ? iconInfo.icon_url : undefined}
          />
          <div className="absolute -right-1 -bottom-1 z-10">
            <span aria-hidden className={cn(iconClassName, 'size-4')} />
          </div>
        </div>
        <div className="flex grow flex-col gap-y-1 overflow-hidden py-px">
          <div className="truncate system-md-semibold text-text-secondary" title={name}>
            {name}
          </div>
          <div className="system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $[`chunkingMode.${DOC_FORM_TEXT[chunkStructure]}`], { ns: 'dataset' })}
          </div>
        </div>
      </div>
      <p
        className="line-clamp-3 grow px-4 py-1 system-xs-regular text-text-tertiary"
        title={description}
      >
        {description}
      </p>
    </>
  )
}

export default React.memo(Content)
