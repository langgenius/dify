'use client'

import type { Hotkey } from '@tanstack/react-hotkeys'
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useEffect, useRef } from 'react'
import { MARKETPLACE_CONTAINER_ID } from '../constants'
import EmbeddedMarketplaceSearch from './embedded-marketplace-search'
import styles from './home-sticky.module.css'
import { preserveStickySearchScroll } from './preserve-sticky-search-scroll'

const SEARCH_HOTKEY = 'Mod+K' satisfies Hotkey

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

  useEffect(() => {
    const searchRoot = searchRef.current
    const container = document.getElementById(MARKETPLACE_CONTAINER_ID)
    if (!searchRoot || !container) return
    return preserveStickySearchScroll(searchRoot, container)
  }, [])

  useHotkey(
    SEARCH_HOTKEY,
    (event) => {
      if (event.defaultPrevented) return

      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      searchRef.current?.querySelector('input')?.focus({ preventScroll: true })
    },
    {
      enabled: enableSearchShortcut,
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    },
  )

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
        {children ?? <EmbeddedMarketplaceSearch />}
      </div>
    </div>
  )
}

export default HomeSearch
