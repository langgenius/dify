'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'
import SearchBoxWrapper from '@/app/components/plugins/marketplace/search-box/search-box-wrapper'

type HomeSearchProps = {
  isMarketplacePlatform: boolean
}

const HomeSearch = ({ isMarketplacePlatform }: HomeSearchProps) => {
  const searchRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation('plugin')

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
          wrapperClassName="w-full max-w-none"
          inputClassName="h-9 w-full rounded-[10px] border-divider-subtle bg-components-input-bg-destructive shadow-xs backdrop-blur-[5px] [&>div]:px-2.5"
          inputElementClassName="text-[14px] leading-5"
          placeholder={t(($) => $['marketplace.home.searchPlaceholder'])}
          showTags={false}
          usedInMarketplace={false}
        />
      </div>
    </div>
  )
}

export default HomeSearch
