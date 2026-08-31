'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import { MARKETPLACE_CONTAINER_ID } from '../constants'
import PluginTypeSwitch from '../plugin-type-switch'
import { focusCatalogTab, getFocusedCatalogTabHref } from './home-catalog-focus'
import { HOME_HEADER_HEIGHT_PX } from './home-constants'
import { homeCatalogPinnedAtom } from './home-sticky-state'
import styles from './home-sticky.module.css'

type HomeCatalogNavigationProps = {
  catalogCategories?: ReactNode
  catalogLeading?: ReactNode
  catalogTabs: ReactNode
  catalogTrailing?: ReactNode
  isMarketplacePlatform: boolean
}

function HomeCatalogNavigation({
  catalogCategories,
  catalogLeading,
  catalogTabs,
  catalogTrailing,
  isMarketplacePlatform,
}: HomeCatalogNavigationProps) {
  const { t } = useTranslation()
  const isPinned = useAtomValue(homeCatalogPinnedAtom)
  const setIsPinned = useSetAtom(homeCatalogPinnedAtom)
  const isPinnedRef = useRef(isPinned)
  const pendingFocusedTabHrefRef = useRef<string | null>(null)
  const catalogTabsRegionRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    isPinnedRef.current = isPinned
    const focusedTabHref = pendingFocusedTabHrefRef.current
    if (!focusedTabHref) return

    pendingFocusedTabHrefRef.current = null
    focusCatalogTab(isPinned ? 'header' : 'content', focusedTabHref)
  }, [isPinned])

  useEffect(() => {
    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)
    if (!scrollContainer) return
    const desktopHeaderSlotQuery =
      isMarketplacePlatform && typeof window.matchMedia === 'function'
        ? window.matchMedia('(min-width: 880px)')
        : null

    const updatePinnedState = () => {
      const catalogTabsRegion = catalogTabsRegionRef.current
      if (!catalogTabsRegion) return

      const containerTop = scrollContainer.getBoundingClientRect().top
      const catalogTabsRegionBottom = catalogTabsRegion.getBoundingClientRect().bottom
      const canUseHeaderSlot =
        !isMarketplacePlatform || !desktopHeaderSlotQuery || desktopHeaderSlotQuery.matches
      const nextIsPinned =
        canUseHeaderSlot && catalogTabsRegionBottom <= containerTop + HOME_HEADER_HEIGHT_PX
      if (nextIsPinned === isPinnedRef.current) return

      pendingFocusedTabHrefRef.current = getFocusedCatalogTabHref(
        nextIsPinned ? 'content' : 'header',
      )
      isPinnedRef.current = nextIsPinned
      setIsPinned(nextIsPinned)
    }

    updatePinnedState()
    scrollContainer.addEventListener('scroll', updatePinnedState, { passive: true })
    desktopHeaderSlotQuery?.addEventListener('change', updatePinnedState)
    window.addEventListener('resize', updatePinnedState)

    return () => {
      scrollContainer.removeEventListener('scroll', updatePinnedState)
      desktopHeaderSlotQuery?.removeEventListener('change', updatePinnedState)
      window.removeEventListener('resize', updatePinnedState)
    }
  }, [isMarketplacePlatform, setIsPinned])

  return (
    <div className={styles.catalogNavigationGroup}>
      <div
        ref={catalogTabsRegionRef}
        className={cn('w-full shrink-0 bg-background-default', styles.catalogTabsRegion)}
      >
        <div
          aria-hidden={isPinned ? true : undefined}
          className={cn(styles.catalogTabs, isPinned && styles.catalogTabsPinned)}
          data-home-catalog-tabs-slot="content"
          inert={isPinned ? true : undefined}
        >
          {catalogTabs}
        </div>
      </div>
      <section
        aria-label={t(($) => $['mainNav.marketplace'], { ns: 'common' })}
        className={cn(
          'w-full shrink-0 bg-background-default',
          styles.catalogNavigation,
          isPinned && styles.catalogNavigationPinned,
        )}
        // Pins directly below the header, so the offset is the header height.
        style={{ top: HOME_HEADER_HEIGHT_PX }}
      >
        <div className="w-full">
          <div className="flex w-full items-center gap-2">
            {catalogLeading ? (
              <>
                <div className={cn('shrink-0', styles.catalogLeading)}>{catalogLeading}</div>
                <div
                  aria-hidden
                  className={cn(
                    'mx-1 h-3.5 w-px shrink-0 bg-divider-regular',
                    styles.catalogLeadingDivider,
                  )}
                />
              </>
            ) : null}
            <div className="min-w-0 flex-1 scrollbar-none overflow-x-auto">
              {catalogCategories ?? <PluginTypeSwitch className={undefined} variant="home" />}
            </div>
            {catalogTrailing ? <div className="shrink-0">{catalogTrailing}</div> : null}
          </div>
        </div>
      </section>
    </div>
  )
}

export default HomeCatalogNavigation
