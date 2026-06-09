'use client'

import type { PluginDetail } from '../types'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useTranslation } from 'react-i18next'
import { ReadmePanelContent } from './content'

type ReadmeDrawerProps = {
  detail: PluginDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerId?: string
}

export function ReadmeDrawer({
  detail,
  open,
  onOpenChange,
  triggerId,
}: ReadmeDrawerProps) {
  const { t } = useTranslation()

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      triggerId={triggerId}
      modal
      swipeDirection="left"
    >
      <DrawerPortal>
        <DrawerBackdrop className="bg-transparent" />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=left]:top-16 data-[swipe-direction=left]:bottom-2 data-[swipe-direction=left]:left-2 data-[swipe-direction=left]:h-auto data-[swipe-direction=left]:w-150 data-[swipe-direction=left]:max-w-[calc(100vw-1rem)] data-[swipe-direction=left]:rounded-2xl data-[swipe-direction=left]:border-l-[0.5px]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0">
              <ReadmePanelContent
                detail={detail}
                title={(
                  <DrawerTitle className="truncate text-xs font-medium text-text-tertiary uppercase">
                    {t('readmeInfo.title', { ns: 'plugin' })}
                  </DrawerTitle>
                )}
                closeButton={(
                  <DrawerCloseButton aria-label={t('operation.close', { ns: 'common' })} />
                )}
              />
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
