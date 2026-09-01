'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import { MARKETPLACE_CONTAINER_ID } from '../constants'
import styles from './home-sticky.module.css'
import MarketplacePluginSearch from './marketplace-plugin-search'
import { preserveStickySearchScroll } from './preserve-sticky-search-scroll'

type HomeSearchProps = {
  children?: ReactNode
  /**
   * Registers the global Cmd/Ctrl+K focus shortcut. The embedded console
   * already binds Mod+K to GotoAnything, so only the standalone marketplace
   * should keep this enabled.
   */
  enableSearchShortcut?: boolean
  /**
   * Pull the search row up over the hero. Search-results (and any other
   * page without a hero) must leave this off so the field stays below the
   * header instead of covering the brand.
   */
  overlapHero?: boolean
}

const HomeSearch = ({
  children,
  enableSearchShortcut = true,
  overlapHero = true,
}: HomeSearchProps) => {
  const searchRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation('plugin')

  useEffect(() => {
    const searchRoot = searchRef.current
    const container = document.getElementById(MARKETPLACE_CONTAINER_ID)
    if (!searchRoot || !container) return
    return preserveStickySearchScroll(searchRoot, container)
  }, [])

  useEffect(() => {
    if (!enableSearchShortcut) return

    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return

      event.preventDefault()
      searchRef.current?.querySelector('input')?.focus({ preventScroll: true })
    }

    document.addEventListener('keydown', handleGlobalSearchShortcut)
    return () => document.removeEventListener('keydown', handleGlobalSearchShortcut)
  }, [enableSearchShortcut])

  return (
    <div
      className={cn(
        'pointer-events-none flex shrink-0 justify-center',
        overlapHero && '-mt-9',
        styles.search,
      )}
    >
      <div
        ref={searchRef}
        className={cn('pointer-events-auto relative w-full', styles.searchContent)}
      >
        {children ?? (
          <MarketplacePluginSearch
            placeholder={t(($) => $['marketplace.home.searchPlaceholder'])}
          />
        )}
      </div>
    </div>
  )
}

export default HomeSearch
