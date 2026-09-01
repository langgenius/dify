'use client'

import type { ReactNode, RefObject } from 'react'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useEffect } from 'react'
import { MAIN_NAV_DESKTOP_MEDIA_QUERY } from '../responsive-classes'

type MobileNavDrawerProps = {
  children: ReactNode
  finalFocusRef: RefObject<HTMLButtonElement | null>
  onOpenChange: (open: boolean) => void
  open: boolean
  title: string
}

export default function MobileNavDrawer({
  children,
  finalFocusRef,
  onOpenChange,
  open,
  title,
}: MobileNavDrawerProps) {
  useEffect(() => {
    if (!open) return

    const desktopMediaQuery = window.matchMedia(MAIN_NAV_DESKTOP_MEDIA_QUERY)
    if (desktopMediaQuery.matches) {
      onOpenChange(false)
      return
    }

    const closeAtDesktopBreakpoint = (event: MediaQueryListEvent) => {
      if (event.matches) onOpenChange(false)
    }
    desktopMediaQuery.addEventListener('change', closeAtDesktopBreakpoint)

    return () => {
      desktopMediaQuery.removeEventListener('change', closeAtDesktopBreakpoint)
    }
  }, [onOpenChange, open])

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="left">
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup
            finalFocus={() =>
              window.matchMedia(MAIN_NAV_DESKTOP_MEDIA_QUERY).matches
                ? false
                : finalFocusRef.current
            }
            className="data-[swipe-direction=left]:w-62 data-[swipe-direction=left]:max-w-[calc(100vw-1rem)]"
          >
            <DrawerTitle className="sr-only">{title}</DrawerTitle>
            <DrawerContent
              className="flex min-h-0 flex-1 flex-col p-0 pb-0"
              onClick={(event) => {
                if ((event.target as Element).closest('a')) onOpenChange(false)
              }}
            >
              {children}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
