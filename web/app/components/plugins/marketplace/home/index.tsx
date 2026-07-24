'use client'

import type { BannerRecommend } from './banners'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import ListWrapper from '../list/list-wrapper'
import HomeCatalogNavigation from './home-catalog-navigation'
import HomeHeader from './home-header'
import HomeHero from './home-hero'
import HomeSearch from './home-search'
import HomeTrending from './home-trending'

type MarketplaceHomeProps = {
  actions?: React.ReactNode
  banners: BannerRecommend[]
  brandName?: React.ReactNode
  isMarketplacePlatform: boolean
  linkToMarketplaceDetail: boolean
  showInstallButton: boolean
}

const MarketplaceHome = ({
  actions,
  banners,
  brandName,
  isMarketplacePlatform,
  linkToMarketplaceDetail,
  showInstallButton,
}: MarketplaceHomeProps) => {
  const [isCatalogPinned, setIsCatalogPinned] = useState(false)

  return (
    <div className="flex min-h-full w-full flex-col bg-background-default">
      <HomeHeader
        actions={actions}
        brandName={brandName}
        isMarketplacePlatform={isMarketplacePlatform}
        showCatalogTabs={isCatalogPinned}
      />
      <div className="relative flex w-full flex-col">
        <HomeHero isMarketplacePlatform={isMarketplacePlatform} />
        <HomeSearch />
        <div
          aria-hidden="true"
          className={cn('shrink-0', isMarketplacePlatform ? 'h-6' : 'h-12')}
        />
        <HomeTrending banners={banners} isMarketplacePlatform={isMarketplacePlatform} />
        <HomeCatalogNavigation
          isPinned={isCatalogPinned}
          isMarketplacePlatform={isMarketplacePlatform}
          onPinnedChange={setIsCatalogPinned}
        />
        <div className="contents [&>div]:bg-background-default!">
          <ListWrapper
            showInstallButton={showInstallButton}
            linkToMarketplaceDetail={linkToMarketplaceDetail}
          />
        </div>
      </div>
    </div>
  )
}

export default MarketplaceHome
