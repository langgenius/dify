import type { ReactNode } from 'react'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'

type AppInfoDetailDrawerProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function AppInfoDetailDrawer({
  open,
  onClose,
  children,
}: AppInfoDetailDrawerProps) {
  return (
    <Drawer
      open={open}
      swipeDirection="left"
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop className="cursor-default bg-app-detail-overlay-bg" />
        <DrawerViewport>
          <DrawerPopup
            aria-label="App info"
            className="border-divider-burn bg-app-detail-bg p-0 data-[swipe-direction=left]:top-2 data-[swipe-direction=left]:bottom-2 data-[swipe-direction=left]:left-2 data-[swipe-direction=left]:h-auto data-[swipe-direction=left]:w-[452px] data-[swipe-direction=left]:max-w-[calc(100vw-1rem)] data-[swipe-direction=left]:rounded-2xl data-[swipe-direction=left]:border-r"
          >
            <DrawerContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 pb-0">
              {children}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
