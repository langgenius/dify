import type { BannerRecommend } from './banners'
import { cn } from '@langgenius/dify-ui/cn'
import ListWrapper from '../list/list-wrapper'
import HomeCatalogNavigation from './home-catalog-navigation'
import HomeCatalogTabs from './home-catalog-tabs'
import HomeHeader from './home-header'
import HomeHero from './home-hero'
import HomeSearch from './home-search'
import { HomeStickyStateProvider } from './home-sticky-state-provider'
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
  return (
    <HomeStickyStateProvider>
      <div className="flex min-h-full w-full flex-col bg-background-default">
        <HomeHeader
          actions={actions}
          brandName={brandName}
          isMarketplacePlatform={isMarketplacePlatform}
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
            catalogTabs={<HomeCatalogTabs isMarketplacePlatform={isMarketplacePlatform} />}
          />
          <div className="contents [&>div]:bg-background-default!">
            <ListWrapper
              showInstallButton={showInstallButton}
              linkToMarketplaceDetail={linkToMarketplaceDetail}
            />
          </div>
        </div>
      </div>
    </HomeStickyStateProvider>
  )
}

export default MarketplaceHome
