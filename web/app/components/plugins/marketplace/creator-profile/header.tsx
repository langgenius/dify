'use client'

import type { MarketplaceSearchSelection } from '../home/marketplace-search-autocomplete'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import HomeCatalogTabs from '../home/home-catalog-tabs'
import HomeGuide from '../home/home-guide'
import { MarketplaceSearchAutocomplete } from '../home/marketplace-search-autocomplete'
import { MarketplaceLogo } from '../marketplace-logo'

type CreatorProfileHeaderProps = {
  actions?: React.ReactNode
  locale: string
  onSuggestionSelect: (selection: MarketplaceSearchSelection) => void
}

export default function CreatorProfileHeader({
  actions,
  locale,
  onSuggestionSelect,
}: CreatorProfileHeaderProps) {
  const { t } = useTranslation()
  const [searchValue, setSearchValue] = useState('')

  return (
    <header className="sticky top-0 z-50 flex h-12 w-full shrink-0 items-center gap-4 border-b border-divider-regular bg-background-default px-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link
          href="/marketplace"
          aria-label="Dify Marketplace"
          className="flex h-full w-[141.933px] shrink-0 items-center"
        >
          <MarketplaceLogo />
        </Link>
        <div className="hidden md:block">
          <HomeCatalogTabs activeTab={null} isMarketplacePlatform={false} />
        </div>
      </div>

      <div className="hidden w-80 shrink-0 md:block">
        <MarketplaceSearchAutocomplete
          locale={locale}
          onSuggestionSelect={onSuggestionSelect}
          onValueChange={setSearchValue}
          placeholder={t(($) => $['marketplace.creatorProfile.searchPlaceholder'], {
            ns: 'plugin',
          })}
          scope="all"
          value={searchValue}
        />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
        <div className="hidden md:block">
          <HomeGuide isMarketplacePlatform={false} />
        </div>
        {actions}
      </div>
    </header>
  )
}
