import type { HomeCatalogTab, HomeCatalogTabLabels } from './home-catalog-tabs'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'
import MarketplaceLogoDark from '@/public/marketplace/dify-marketplace-logo-dark.svg'
import MarketplaceLogo from '@/public/marketplace/dify-marketplace-logo.svg'
import HomeCatalogTabs from './home-catalog-tabs'
import { HOME_HEADER_HEIGHT_PX } from './home-constants'
// HomeCreatorCenter stays in its own client module: it derives styles via
// buttonVariants(), which cannot be invoked inside this server component.
import HomeCreatorCenter from './home-creator-center'
import HomeGuide from './home-guide'
import { HomeStickyCatalogTabs } from './home-sticky-state-provider'
import styles from './home-sticky.module.css'

type HomeHeaderProps = {
  activeTab?: HomeCatalogTab
  actions?: React.ReactNode
  catalogLabels?: HomeCatalogTabLabels
  isMarketplacePlatform: boolean
  language?: string
}

const HomeHeader = ({
  activeTab = 'plugins',
  actions,
  catalogLabels,
  isMarketplacePlatform,
  language,
}: HomeHeaderProps) => {
  return (
    <header
      className="sticky top-0 z-50 flex w-full shrink-0 items-center gap-4 bg-background-default px-4 py-1.5 md:px-9"
      style={{ height: HOME_HEADER_HEIGHT_PX }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link
          // In the embedded console "/" leaves the marketplace entirely, so
          // the brand mark points back at the marketplace home instead.
          href={isMarketplacePlatform ? '/' : '/marketplace'}
          aria-label="Dify Marketplace"
          className="flex h-full w-[141.933px] shrink-0 items-center"
        >
          <img
            alt=""
            aria-hidden
            className={cn(
              'h-[16.386px] w-[141.761px] max-w-none shrink-0',
              styles.marketplaceLogoLight,
            )}
            height="16.386"
            src={MarketplaceLogo.src}
            width="141.761"
          />
          <img
            alt=""
            aria-hidden
            className={cn(
              'h-[16.386px] w-[141.761px] max-w-none shrink-0',
              styles.marketplaceLogoDark,
            )}
            height="16.386"
            src={MarketplaceLogoDark.src}
            width="141.761"
          />
        </Link>
        <HomeStickyCatalogTabs>
          <HomeCatalogTabs
            activeTab={activeTab}
            className={styles.headerCatalogTabs}
            isMarketplacePlatform={isMarketplacePlatform}
            labels={catalogLabels}
            language={language}
          />
        </HomeStickyCatalogTabs>
      </div>

      <div className="flex h-full min-w-0 flex-1 items-center justify-end gap-2.5">
        <HomeCreatorCenter />
        <HomeGuide isMarketplacePlatform={isMarketplacePlatform} />
        {actions}
      </div>
    </header>
  )
}

export default HomeHeader
