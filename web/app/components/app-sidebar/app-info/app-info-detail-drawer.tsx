import type { DrawerRootProps } from '@langgenius/dify-ui/drawer'
import type { ReactNode } from 'react'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import * as React from 'react'

type AppInfoDetailDrawerProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
}

type DrawerOpenChange = NonNullable<DrawerRootProps['onOpenChange']>

const APP_INFO_DETAIL_DRAWER_POPUP_CLASS_NAME = [
  '!absolute pointer-events-auto border-0 border-r border-divider-burn bg-app-detail-bg shadow-none',
  'data-[swipe-direction=left]:!top-2 data-[swipe-direction=left]:!bottom-2 data-[swipe-direction=left]:!left-2 data-[swipe-direction=left]:!h-auto',
  'data-[swipe-direction=left]:!w-[452px] data-[swipe-direction=left]:!max-w-[calc(100vw-1rem)] data-[swipe-direction=left]:!rounded-2xl',
].join(' ')

export function AppInfoDetailDrawer({
  open,
  onClose,
  children,
}: AppInfoDetailDrawerProps) {
  const portalContainerRef = React.useRef<HTMLDivElement>(null)
  const handleOpenChange = React.useCallback<DrawerOpenChange>((nextOpen) => {
    if (!nextOpen)
      onClose()
  }, [onClose])

  return (
    <>
      <div ref={portalContainerRef} />
      <Drawer
        open={open}
        modal={false}
        disablePointerDismissal
        swipeDirection="left"
        onOpenChange={handleOpenChange}
      >
        <DrawerPortal container={portalContainerRef}>
          <DrawerBackdrop
            className="!absolute !inset-0 bg-app-detail-overlay-bg"
            onClick={onClose}
          />
          <DrawerViewport className="pointer-events-none !absolute !inset-0">
            <DrawerPopup className={APP_INFO_DETAIL_DRAWER_POPUP_CLASS_NAME}>
              <DrawerContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 pb-0">
                {children}
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </>
  )
}
