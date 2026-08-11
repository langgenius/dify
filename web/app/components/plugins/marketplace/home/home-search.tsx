'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import styles from './home-sticky.module.css'
import MarketplacePluginSearch from './marketplace-plugin-search'

const HomeSearch = ({ children }: { children?: ReactNode }) => {
  const searchRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation('plugin')

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return

      event.preventDefault()
      searchRef.current?.querySelector('input')?.focus()
    }

    document.addEventListener('keydown', handleGlobalSearchShortcut)
    return () => document.removeEventListener('keydown', handleGlobalSearchShortcut)
  }, [])

  return (
    <div
      className={cn(
        'pointer-events-none sticky z-[60] -mt-9 flex h-9 shrink-0 justify-center',
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
