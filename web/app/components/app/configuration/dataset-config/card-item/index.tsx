'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useKnowledge } from '@/hooks/use-knowledge'
import SettingsModal from '../settings-modal'

type ItemProps = {
  className?: string
  config: DataSet
  onRemove: (id: string) => void
  readonly?: boolean
  onSave: (newDataset: DataSet) => void
  editable?: boolean
}

const Item: FC<ItemProps> = ({
  config,
  onSave,
  onRemove,
  readonly = false,
  editable = true,
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const { t } = useTranslation()

  const handleSave = (newDataset: DataSet) => {
    onSave(newDataset)
    setShowSettingsModal(false)
  }

  const [isDeleting, setIsDeleting] = useState(false)

  const iconInfo = config.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }

  return (
    <div className={cn(
      'group relative mb-1 flex h-10 w-full cursor-pointer items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 last-of-type:mb-0 hover:bg-components-panel-on-panel-item-bg-hover',
      isDeleting && 'border-state-destructive-border hover:bg-state-destructive-hover',
      readonly && 'cursor-not-allowed',
    )}
    >
      <div className="flex w-0 grow items-center space-x-1.5">
        <AppIcon
          size="tiny"
          iconType={iconInfo.icon_type}
          icon={iconInfo.icon}
          background={iconInfo.icon_type === 'image' ? undefined : iconInfo.icon_background}
          imageUrl={iconInfo.icon_type === 'image' ? iconInfo.icon_url : undefined}
        />
        <div className="w-0 grow truncate system-sm-medium text-text-secondary" title={config.name}>{config.name}</div>
      </div>
      <div className="ml-2 hidden shrink-0 items-center space-x-1 group-hover:flex">
        {
          editable && !readonly && (
            <ActionButton
              onClick={(e) => {
                e.stopPropagation()
                setShowSettingsModal(true)
              }}
            >
              <RiEditLine className="h-4 w-4 shrink-0 text-text-tertiary" />
            </ActionButton>
          )
        }
        {
          !readonly && (
            <ActionButton
              onClick={() => onRemove(config.id)}
              state={isDeleting ? ActionButtonState.Destructive : ActionButtonState.Default}
              onMouseEnter={() => setIsDeleting(true)}
              onMouseLeave={() => setIsDeleting(false)}
            >
              <RiDeleteBinLine className={cn('h-4 w-4 shrink-0 text-text-tertiary', isDeleting && 'text-text-destructive')} />
            </ActionButton>
          )
        }
      </div>
      {
        !!config.indexing_technique && (
          <Badge
            className="shrink-0 group-hover:hidden"
            text={formatIndexingTechniqueAndMethod(config.indexing_technique, config.retrieval_model_dict?.search_method)}
          />
        )
      }
      {
        config.provider === 'external' && (
          <Badge
            className="shrink-0 group-hover:hidden"
            text={t('externalTag', { ns: 'dataset' }) as string}
          />
        )
      }
      <Drawer
        open={showSettingsModal}
        modal
        swipeDirection="right"
        onOpenChange={(open) => {
          if (!open)
            setShowSettingsModal(false)
        }}
      >
        <DrawerPortal>
          <DrawerBackdrop className={cn(!isMobile && 'bg-transparent')} />
          <DrawerViewport>
            <DrawerPopup className="p-0! data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-3 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-[640px] data-[swipe-direction=right]:rounded-xl">
              <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                {showSettingsModal && (
                  <SettingsModal
                    currentDataset={config}
                    onCancel={() => setShowSettingsModal(false)}
                    onSave={handleSave}
                  />
                )}
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </div>
  )
}

export default Item
