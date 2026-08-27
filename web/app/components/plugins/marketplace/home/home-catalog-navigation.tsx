'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import { MARKETPLACE_CONTAINER_ID } from '../constants'
import PluginTypeSwitch from '../plugin-type-switch'
import { HOME_HEADER_HEIGHT_PX } from './home-constants'
import { homeCatalogPinnedAtom } from './home-sticky-state'
import styles from './home-sticky.module.css'

type HomeCatalogNavigationProps = {
  catalogCategories?: ReactNode
  catalogLeading?: ReactNode
  catalogTabs: ReactNode
  catalogTrailing?: ReactNode
}

function HomeCatalogNavigation({
  catalogCategories,
  catalogLeading,
  catalogTabs,
  catalogTrailing,
}: HomeCatalogNavigationProps) {
  const { t } = useTranslation()
  const isPinned = useAtomValue(homeCatalogPinnedAtom)
  const setIsPinned = useSetAtom(homeCatalogPinnedAtom)
  const pinTriggerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const scrollContainer = document.getElementById(MARKETPLACE_CONTAINER_ID)
    if (!scrollContainer) return

    const previousOverflowAnchor = scrollContainer.style.overflowAnchor
    // The sticky section becomes shorter when its tabs move into the header.
    // Prevent browser scroll anchoring from moving it back across the pin threshold.
    scrollContainer.style.overflowAnchor = 'none'

    const updatePinnedState = () => {
      const pinTrigger = pinTriggerRef.current
      if (!pinTrigger) return

      const containerTop = scrollContainer.getBoundingClientRect().top
      const triggerTop = pinTrigger.getBoundingClientRect().top
      setIsPinned(triggerTop <= containerTop + HOME_HEADER_HEIGHT_PX)
    }

    updatePinnedState()
    scrollContainer.addEventListener('scroll', updatePinnedState, { passive: true })
    window.addEventListener('resize', updatePinnedState)

    return () => {
      scrollContainer.removeEventListener('scroll', updatePinnedState)
      window.removeEventListener('resize', updatePinnedState)
      scrollContainer.style.overflowAnchor = previousOverflowAnchor
    }
  }, [setIsPinned])

  return (
    <>
      <span ref={pinTriggerRef} aria-hidden className={styles.catalogNavigationTrigger} />
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
          <div className={cn('-ml-2', isPinned && styles.catalogTabsPinned)}>{catalogTabs}</div>
          <div
            className={cn(
              'mt-4 flex w-full items-center gap-2',
              isPinned && styles.categoriesPinned,
            )}
          >
            {catalogLeading && (
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
            )}
            <div className="min-w-0 flex-1 scrollbar-none overflow-x-auto">
              {catalogCategories ?? <PluginTypeSwitch className={undefined} variant="home" />}
            </div>
            {catalogTrailing && <div className="shrink-0">{catalogTrailing}</div>}
          </div>
        </div>
      </section>
    </>
  )
}

export default HomeCatalogNavigation
