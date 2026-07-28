'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import PluginTypeSwitch from '../plugin-type-switch'
import { homeCatalogPinnedAtom } from './home-sticky-state'
import styles from './home-sticky.module.css'

type HomeCatalogNavigationProps = {
  catalogCategories?: ReactNode
  catalogTabs: ReactNode
}

const STICKY_TOP = 48

function HomeCatalogNavigation({ catalogCategories, catalogTabs }: HomeCatalogNavigationProps) {
  const { t } = useTranslation()
  const isPinned = useAtomValue(homeCatalogPinnedAtom)
  const setIsPinned = useSetAtom(homeCatalogPinnedAtom)
  const pinTriggerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const scrollContainer = document.getElementById('marketplace-container')
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
      setIsPinned(triggerTop <= containerTop + STICKY_TOP)
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
      >
        <div className="w-full">
          <div className={cn('-ml-2', isPinned && styles.catalogTabsPinned)}>{catalogTabs}</div>
          {catalogCategories ? (
            <div className={cn('mt-4', isPinned && styles.categoriesPinned)}>
              {catalogCategories}
            </div>
          ) : (
            <PluginTypeSwitch
              className={cn('mt-4', isPinned && styles.categoriesPinned)}
              variant="home"
            />
          )}
        </div>
      </section>
    </>
  )
}

export default HomeCatalogNavigation
