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
import { useCallback } from 'react'

type FeaturePanelDrawerProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
  inWorkflow?: boolean
}

export function FeaturePanelDrawer({
  className,
  children,
  show,
  onClose,
  inWorkflow = true,
}: FeaturePanelDrawerProps) {
  const close = useCallback(() => onClose?.(), [onClose])

  return (
    <Drawer
      open={show}
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open)
          close()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop className="bg-black/25" />
        <DrawerViewport data-testid="feature-panel-drawer-layout">
          <DrawerPopup
            className={cn(
              'border-components-panel-border bg-components-panel-bg-alt p-0 text-left align-middle',
              'data-[swipe-direction=right]:!h-auto data-[swipe-direction=right]:!w-[420px] data-[swipe-direction=right]:!max-w-[calc(100vw-2rem)]',
              inWorkflow
                ? 'data-[swipe-direction=right]:!top-[112px] data-[swipe-direction=right]:!right-0 data-[swipe-direction=right]:!bottom-2 data-[swipe-direction=right]:!rounded-l-2xl data-[swipe-direction=right]:!rounded-r-none data-[swipe-direction=right]:!border-t-[0.5px] data-[swipe-direction=right]:!border-r-0 data-[swipe-direction=right]:!border-b-[0.5px] data-[swipe-direction=right]:!border-l-[0.5px]'
                : 'data-[swipe-direction=right]:!top-[64px] data-[swipe-direction=right]:!right-2 data-[swipe-direction=right]:!bottom-2 data-[swipe-direction=right]:!rounded-2xl data-[swipe-direction=right]:!border-[0.5px]',
              className,
            )}
          >
            <DrawerContent className="flex min-h-0 flex-1 touch-auto flex-col overflow-hidden p-0 pb-0">
              {children}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
