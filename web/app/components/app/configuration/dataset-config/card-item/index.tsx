'use client'
import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { DrawerActions } from '@langgenius/dify-ui/drawer'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTrigger,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useKnowledge } from '@/hooks/use-knowledge'
import SettingsModal from '../settings-modal'

type ItemProps = {
  className?: string
  config: DatasetDetailWithPartialMembersResponse
  onRemove: (id: string) => void
  readonly?: boolean
  onSave: (newDataset: DatasetDetailWithPartialMembersResponse) => void
  editable?: boolean
}

const Item: FC<ItemProps> = ({ config, onSave, onRemove, readonly = false, editable = true }) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const settingsDrawerActionsRef = useRef<DrawerActions>(null)
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const { t } = useTranslation(['common', 'dataset'])

  const handleSave = (newDataset: DatasetDetailWithPartialMembersResponse) => {
    onSave(newDataset)
    settingsDrawerActionsRef.current?.close()
  }

  const [isDeleting, setIsDeleting] = useState(false)

  const iconInfo = config.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }

  return (
    <div
      className={cn(
        'group relative mb-1 flex h-10 w-full cursor-pointer items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 last-of-type:mb-0 hover:bg-components-panel-on-panel-item-bg-hover',
        isDeleting && 'border-state-destructive-border hover:bg-state-destructive-hover',
        readonly && 'cursor-not-allowed',
      )}
    >
      <div className="flex w-0 grow items-center space-x-1.5">
        <AppIcon size="tiny" icon={iconInfo} />
        <div className="w-0 grow truncate system-sm-medium text-text-secondary" title={config.name}>
          {config.name}
        </div>
      </div>
      <div className="ml-2 hidden shrink-0 items-center space-x-1 group-hover:flex">
        {editable && !readonly && (
          <Drawer actionsRef={settingsDrawerActionsRef} modal swipeDirection="right">
            <DrawerTrigger
              render={
                <IconButton
                  aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span
                    aria-hidden="true"
                    className="i-ri-edit-line size-4 shrink-0 text-text-tertiary"
                  />
                </IconButton>
              }
            />
            <DrawerPortal>
              <DrawerBackdrop className={cn(!isMobile && 'bg-transparent')} />
              <DrawerViewport>
                <DrawerPopup className="p-0! data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-3 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-160 data-[swipe-direction=right]:rounded-xl">
                  <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                    <SettingsModal
                      currentDataset={config}
                      onCancel={() => settingsDrawerActionsRef.current?.close()}
                      onSave={handleSave}
                    />
                  </DrawerContent>
                </DrawerPopup>
              </DrawerViewport>
            </DrawerPortal>
          </Drawer>
        )}
        {!readonly && (
          <IconButton
            aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
            tone="destructive"
            onClick={() => onRemove(config.id)}
            onMouseEnter={() => setIsDeleting(true)}
            onMouseLeave={() => setIsDeleting(false)}
          >
            <span aria-hidden="true" className="i-ri-delete-bin-line size-4 shrink-0" />
          </IconButton>
        )}
      </div>
      {!!config.indexing_technique && (
        <Badge
          className="shrink-0 group-hover:hidden"
          text={formatIndexingTechniqueAndMethod(
            config.indexing_technique,
            config.retrieval_model_dict?.search_method,
          )}
        />
      )}
      {config.provider === 'external' && (
        <Badge
          className="shrink-0 group-hover:hidden"
          text={t(($) => $.externalTag, { ns: 'dataset' }) as string}
        />
      )}
    </div>
  )
}

export default Item
