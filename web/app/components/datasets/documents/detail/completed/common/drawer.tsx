import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'

type DrawerSide = 'right' | 'left' | 'bottom' | 'top'
type DrawerSwipeDirection = 'right' | 'left' | 'down' | 'up'

type CompletedDrawerProps = {
  open: boolean
  onClose: () => void
  side?: DrawerSide
  panelClassName?: string
  panelContentClassName?: string
  modal?: boolean
  children: ReactNode
}

const SIDE_TO_SWIPE_DIRECTION: Record<DrawerSide, DrawerSwipeDirection> = {
  right: 'right',
  left: 'left',
  bottom: 'down',
  top: 'up',
}

const DRAWER_POPUP_CLASS_NAME = [
  'pointer-events-auto overflow-visible bg-transparent shadow-none ring-0',
  'data-[swipe-direction=right]:h-screen data-[swipe-direction=right]:max-w-none data-[swipe-direction=right]:rounded-none',
  'data-[swipe-direction=left]:h-screen data-[swipe-direction=left]:max-w-none data-[swipe-direction=left]:rounded-none',
  'data-[swipe-direction=down]:max-h-none data-[swipe-direction=down]:rounded-none',
  'data-[swipe-direction=up]:max-h-none data-[swipe-direction=up]:rounded-none',
].join(' ')

export function CompletedDrawer({
  open,
  onClose,
  side = 'right',
  children,
  panelClassName,
  panelContentClassName,
  modal = false,
}: CompletedDrawerProps) {
  if (!open) return null

  return (
    <Drawer
      open={open}
      modal={modal}
      swipeDirection={SIDE_TO_SWIPE_DIRECTION[side]}
      disablePointerDismissal
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <DrawerPortal>
        {modal && <DrawerBackdrop onClick={onClose} />}
        <DrawerViewport className="pointer-events-none">
          <DrawerPopup
            aria-modal={modal ? 'true' : 'false'}
            className={cn(DRAWER_POPUP_CLASS_NAME, panelClassName)}
          >
            <DrawerContent className={cn('grow overflow-visible', panelContentClassName)}>
              {children}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
