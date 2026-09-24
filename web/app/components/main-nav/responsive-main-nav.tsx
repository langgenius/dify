'use client'

import type { MainNavProps } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { MainNav } from '.'

const compactNavigationQuery = '(width < 48rem)'
const subscribe = (onChange: () => void) => {
  const mediaQuery = window.matchMedia(compactNavigationQuery)
  mediaQuery.addEventListener('change', onChange)
  return () => mediaQuery.removeEventListener('change', onChange)
}
const getSnapshot = () => window.matchMedia(compactNavigationQuery).matches
const getServerSnapshot = () => false

export function ResponsiveMainNav({ initialPlatform }: Pick<MainNavProps, 'initialPlatform'>) {
  const { t } = useTranslation(['common'])
  const isCompact = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (!isCompact) return <MainNav initialPlatform={initialPlatform} />

  return (
    <div className="shrink-0 p-2">
      <Drawer swipeDirection="left">
        <DrawerTrigger render={<Button variant="secondary" />}>
          <span aria-hidden="true" className="i-ri-menu-line size-4" />
          {t(($) => $['navigation.primary'])}
        </DrawerTrigger>
        <DrawerPortal>
          <DrawerBackdrop className="fixed" />
          <DrawerViewport>
            <DrawerPopup>
              <div className="flex shrink-0 items-center justify-between gap-2 p-3">
                <DrawerTitle className="system-md-semibold">
                  {t(($) => $['navigation.primary'])}
                </DrawerTitle>
                <DrawerCloseButton aria-label={t(($) => $['operation.close'])} />
              </div>
              <DrawerContent className="touch-auto p-0 pb-0">
                <MainNav
                  initialPlatform={initialPlatform}
                  className="h-auto min-h-full w-full overflow-visible [&>div]:shrink-0 [&>div]:overflow-visible"
                />
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </div>
  )
}
