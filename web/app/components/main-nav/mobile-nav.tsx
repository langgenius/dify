'use client'

import type { MouseEvent } from 'react'
import type { MainNavProps } from './types'
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
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePathname } from '@/next/navigation'
import { MainNavFooter, MainNavLogo, MainNavPanel } from '.'

function isPlainLinkClick(event: MouseEvent) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  return (
    event.target instanceof Element &&
    event.target.closest('a[href]:not([target="_blank"])') !== null
  )
}

export function MainNavMobileBar({ initialPlatform }: Pick<MainNavProps, 'initialPlatform'>) {
  const { t } = useTranslation(['common'])
  const pathname = usePathname()
  const [openedOn, setOpenedOn] = useState<{ pathname: string } | null>(null)
  const isAtLeastMd = useMediaQuery('(width >= 48rem)', {})
  if (isAtLeastMd && openedOn) setOpenedOn(null)
  const open = openedOn?.pathname === pathname
  const setOpen = (nextOpen: boolean) => setOpenedOn(nextOpen ? { pathname } : null)

  const menuLabel = t(($) => $['navigation.primary'], { ns: 'common' })

  return (
    <header className="flex shrink-0 items-center justify-between bg-background-body ps-4 pe-2 pt-3 pb-2 md:hidden">
      <MainNavLogo />
      <Drawer swipeDirection="left" open={open} onOpenChange={setOpen}>
        <DrawerTrigger
          render={
            <IconButton aria-label={menuLabel} size="lg">
              <span aria-hidden="true" className="i-ri-menu-line size-4" />
            </IconButton>
          }
        />
        <DrawerPortal>
          <DrawerBackdrop className="fixed" />
          <DrawerViewport>
            <DrawerPopup
              aria-label={menuLabel}
              className="bg-background-body data-[swipe-direction=left]:w-60 data-[swipe-direction=left]:border-y-0"
            >
              <DrawerContent
                className="flex flex-col p-0"
                onClick={(event) => {
                  if (isPlainLinkClick(event)) setOpen(false)
                }}
              >
                <MainNavPanel initialPlatform={initialPlatform} />
                <MainNavFooter />
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </header>
  )
}
