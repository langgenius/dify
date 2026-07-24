'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import PluginTypeSwitch from '../plugin-type-switch'
import HomeCatalogTabs from './home-catalog-tabs'
import styles from './home-sticky.module.css'

type HomeCatalogNavigationProps = {
  isPinned?: boolean
  isMarketplacePlatform: boolean
  onPinnedChange?: (isPinned: boolean) => void
}

const STICKY_TOP = 48

function HomeCatalogNavigation({
  isPinned = false,
  isMarketplacePlatform,
  onPinnedChange,
}: HomeCatalogNavigationProps) {
  const { t } = useTranslation()
  const pinTriggerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!onPinnedChange) return

    const scrollContainer = document.getElementById('marketplace-container')
    if (!scrollContainer) return

    const updatePinnedState = () => {
      const pinTrigger = pinTriggerRef.current
      if (!pinTrigger) return

      const containerTop = scrollContainer.getBoundingClientRect().top
      const triggerTop = pinTrigger.getBoundingClientRect().top
      onPinnedChange(triggerTop <= containerTop + STICKY_TOP)
    }

    updatePinnedState()
    scrollContainer.addEventListener('scroll', updatePinnedState, { passive: true })
    window.addEventListener('resize', updatePinnedState)

    return () => {
      scrollContainer.removeEventListener('scroll', updatePinnedState)
      window.removeEventListener('resize', updatePinnedState)
    }
  }, [onPinnedChange])

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
          <HomeCatalogTabs
            className={cn('-ml-2', isPinned && styles.catalogTabsPinned)}
            isMarketplacePlatform={isMarketplacePlatform}
          />
          <PluginTypeSwitch
            className={cn('mt-4', isPinned && styles.categoriesPinned)}
            variant="home"
          />
        </div>
      </section>
    </>
  )
}

export default HomeCatalogNavigation
