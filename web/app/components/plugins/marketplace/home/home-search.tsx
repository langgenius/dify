'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import SearchBoxWrapper from '@/app/components/plugins/marketplace/search-box/search-box-wrapper'
import styles from './home-sticky.module.css'

const HomeSearch = () => {
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
        'pointer-events-none sticky z-[60] -mt-9 flex h-9 shrink-0 justify-center px-4',
        styles.search,
      )}
    >
      <div ref={searchRef} className="pointer-events-auto relative w-full max-w-[420px]">
        <SearchBoxWrapper
          wrapperClassName="w-full max-w-none"
          inputClassName="h-9 w-full rounded-[10px] bg-components-input-bg-normal [&>div]:px-2.5"
          inputElementClassName="text-[14px] leading-5"
          searchIconName="i-ri-search-line"
          placeholder={t(($) => $['marketplace.home.searchPlaceholder'])}
          showTags={false}
          usedInMarketplace={false}
        />
      </div>
    </div>
  )
}

export default HomeSearch
