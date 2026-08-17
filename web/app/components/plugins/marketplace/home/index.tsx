import type { PluginBanner } from '@dify/contracts/marketplace'
import type { ActivePluginType } from '../constants'
import type { HomeCatalogTabLabels } from './home-catalog-tabs'
import ListWrapper from '../list/list-wrapper'
import HomeCatalogNavigation from './home-catalog-navigation'
import HomeCatalogTabs from './home-catalog-tabs'
import HomeHeader from './home-header'
import HomeHero from './home-hero'
import HomeSearch from './home-search'
import { HomeShell } from './home-shell'
import styles from './home-sticky.module.css'

type MarketplaceHomeProps = {
  actions?: React.ReactNode
  activePluginType?: ActivePluginType
  banners: PluginBanner[]
  catalogCategories?: React.ReactNode
  catalogLabels?: HomeCatalogTabLabels
  isMarketplacePlatform: boolean
  language?: string
  linkToMarketplaceDetail: boolean
  search?: React.ReactNode
  showInstallButton: boolean
}

const MarketplaceHome = ({
  actions,
  activePluginType,
  banners,
  catalogCategories,
  catalogLabels,
  isMarketplacePlatform,
  language,
  linkToMarketplaceDetail,
  search,
  showInstallButton,
}: MarketplaceHomeProps) => {
  return (
    <HomeShell
      banners={banners}
      isMarketplacePlatform={isMarketplacePlatform}
      header={
        <HomeHeader
          actions={actions}
          catalogLabels={catalogLabels}
          isMarketplacePlatform={isMarketplacePlatform}
          language={language}
        />
      }
      hero={<HomeHero isMarketplacePlatform={isMarketplacePlatform} />}
      search={<HomeSearch enableSearchShortcut={isMarketplacePlatform}>{search}</HomeSearch>}
      navigation={
        <HomeCatalogNavigation
          catalogCategories={catalogCategories}
          catalogTabs={
            <HomeCatalogTabs
              isMarketplacePlatform={isMarketplacePlatform}
              labels={catalogLabels}
              language={language}
            />
          }
        />
      }
    >
      <div className="contents [&>div]:bg-background-default!">
        <ListWrapper
          activePluginType={activePluginType}
          className={styles.catalogContent}
          deferOffscreenCollections={!isMarketplacePlatform}
          showInstallButton={showInstallButton}
          linkToMarketplaceDetail={linkToMarketplaceDetail}
        />
      </div>
    </HomeShell>
  )
}

export default MarketplaceHome
