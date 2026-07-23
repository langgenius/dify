'use client'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import SearchBoxWrapper from '@/app/components/plugins/marketplace/search-box/search-box-wrapper'
import { cn } from '@/utils/classnames'

type HomeSearchProps = {
  isMarketplacePlatform: boolean
}

const HomeSearch = ({ isMarketplacePlatform }: HomeSearchProps) => {
  const searchRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey))
        return

      event.preventDefault()
      searchRef.current?.querySelector('input')?.focus()
    }

    document.addEventListener('keydown', handleGlobalSearchShortcut)
    return () => document.removeEventListener('keydown', handleGlobalSearchShortcut)
  }, [])

  return (
    <div
      className={cn(
        'sticky z-[60] -mt-9 flex h-9 shrink-0 justify-center px-4',
        isMarketplacePlatform ? 'top-[5px]' : 'top-1',
      )}
    >
      <div ref={searchRef} className="relative w-full max-w-[480px]">
        <SearchBoxWrapper
          includeSource={false}
          wrapperClassName="!w-full !max-w-none"
          inputClassName="!h-9 !rounded-[10px] !border-divider-subtle !bg-components-input-bg-destructive !pr-14 !shadow-xs"
          placeholder={t('marketplace.home.searchPlaceholder', { ns: 'plugin' })}
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 flex h-5 -translate-y-1/2 items-center rounded-md border border-divider-subtle bg-components-kbd-bg-gray px-1.5 font-sans text-[10px] font-medium leading-3 text-text-tertiary shadow-xs">
          ⌘ K
        </kbd>
      </div>
    </div>
  )
}

export default HomeSearch
