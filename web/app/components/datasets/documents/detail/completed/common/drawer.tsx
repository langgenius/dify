import type { ComponentProps, ReactNode } from 'react'
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
type DrawerOpenChange = NonNullable<ComponentProps<typeof Drawer>['onOpenChange']>

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
  'pointer-events-auto overflow-visible border-0 bg-transparent shadow-none',
  'data-[swipe-direction=right]:h-screen data-[swipe-direction=right]:max-w-none data-[swipe-direction=right]:rounded-none data-[swipe-direction=right]:border-0',
  'data-[swipe-direction=left]:h-screen data-[swipe-direction=left]:max-w-none data-[swipe-direction=left]:rounded-none data-[swipe-direction=left]:border-0',
  'data-[swipe-direction=down]:max-h-none data-[swipe-direction=down]:rounded-none data-[swipe-direction=down]:border-0',
  'data-[swipe-direction=up]:max-h-none data-[swipe-direction=up]:rounded-none data-[swipe-direction=up]:border-0',
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
  const handleOpenChange: DrawerOpenChange = (nextOpen, eventDetails) => {
    if (nextOpen)
      return

    if (eventDetails.reason === 'focus-out' || eventDetails.reason === 'outside-press')
      return

    onClose()
  }

  if (!open)
    return null

  return (
    <Drawer
      open={open}
      modal={modal}
      swipeDirection={SIDE_TO_SWIPE_DIRECTION[side]}
      disablePointerDismissal
      onOpenChange={handleOpenChange}
    >
      <DrawerPortal>
        {modal && (
          <DrawerBackdrop
            onClick={onClose}
          />
        )}
        <DrawerViewport className="pointer-events-none">
          <DrawerPopup
            aria-modal={modal ? 'true' : 'false'}
            className={cn(DRAWER_POPUP_CLASS_NAME, panelClassName)}
          >
            <DrawerContent
              className={cn('flex grow flex-col overflow-visible p-0 pb-0', panelContentClassName)}
            >
              {children}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
