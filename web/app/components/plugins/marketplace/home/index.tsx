import type { PluginBanner } from './banners'
import type { HomeCatalogTabLabels } from './home-catalog-tabs'
import ListWrapper from '../list/list-wrapper'
import HomeCatalogNavigation from './home-catalog-navigation'
import HomeCatalogTabs from './home-catalog-tabs'
import HomeHeader from './home-header'
import HomeHero from './home-hero'
import HomeSearch from './home-search'
import { HomeStickyStateProvider } from './home-sticky-state-provider'
import styles from './home-sticky.module.css'
import HomeTrending from './home-trending'

type MarketplaceHomeProps = {
  actions?: React.ReactNode
  banners: PluginBanner[]
  catalogLabels?: HomeCatalogTabLabels
  isMarketplacePlatform: boolean
  language?: string
  linkToMarketplaceDetail: boolean
  showInstallButton: boolean
}

const MarketplaceHome = ({
  actions,
  banners,
  catalogLabels,
  isMarketplacePlatform,
  language,
  linkToMarketplaceDetail,
  showInstallButton,
}: MarketplaceHomeProps) => {
  return (
    <HomeStickyStateProvider>
      <div className="flex min-h-full w-full flex-col bg-background-default">
        <HomeHeader
          actions={actions}
          catalogLabels={catalogLabels}
          isMarketplacePlatform={isMarketplacePlatform}
          language={language}
        />
        <div className="relative flex w-full flex-col">
          <HomeHero isMarketplacePlatform={isMarketplacePlatform} />
          <HomeSearch />
          {banners.length > 0 && (
            <>
              <div aria-hidden="true" className="h-12 shrink-0" />
              <HomeTrending banners={banners} isMarketplacePlatform={isMarketplacePlatform} />
            </>
          )}
          <HomeCatalogNavigation
            catalogTabs={
              <HomeCatalogTabs
                isMarketplacePlatform={isMarketplacePlatform}
                labels={catalogLabels}
                language={language}
              />
            }
          />
          <div className="contents [&>div]:bg-background-default!">
            <ListWrapper
              className={styles.catalogContent}
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
