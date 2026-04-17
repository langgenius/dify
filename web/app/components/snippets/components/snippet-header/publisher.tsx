'use client'

import type { SnippetDetailUIModel } from '@/models/snippet'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import PublishMenu from '../publish-menu'

type PublisherProps = {
  uiMeta: SnippetDetailUIModel
  draftUpdatedAt: number
  open: boolean
  isPublishing: boolean
  onOpenChange: (open: boolean) => void
  onPublish: () => void
  publishedAt: number
}

const Publisher = ({
  uiMeta,
  draftUpdatedAt,
  open,
  isPublishing,
  onOpenChange,
  onPublish,
  publishedAt,
}: PublisherProps) => {
  const { t } = useTranslation('snippet')

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-lg bg-components-button-primary-bg px-3 py-2 text-white shadow-[0px_2px_2px_-1px_rgba(0,0,0,0.12),0px_1px_1px_-1px_rgba(0,0,0,0.12),0px_0px_0px_0.5px_rgba(9,9,11,0.05)]">
        <span className="text-[13px] leading-4 font-medium">{t('publishButton')}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={6}
        popupClassName="w-80 !rounded-2xl !bg-components-panel-bg !p-0 !shadow-[0px_20px_24px_-4px_rgba(9,9,11,0.08),0px_8px_8px_-4px_rgba(9,9,11,0.03)]"
      >
        <PublishMenu
          draftUpdatedAt={draftUpdatedAt}
          publishedAt={publishedAt}
          uiMeta={uiMeta}
          isPublishing={isPublishing}
          onPublish={onPublish}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(Publisher)
