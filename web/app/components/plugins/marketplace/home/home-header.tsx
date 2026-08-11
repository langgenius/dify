import type { HomeCatalogTab, HomeCatalogTabLabels } from './home-catalog-tabs'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import Link from '@/next/link'
import MarketplaceLogoDark from '@/public/marketplace/dify-marketplace-logo-dark.svg'
import MarketplaceLogo from '@/public/marketplace/dify-marketplace-logo.svg'
import HomeCatalogTabs from './home-catalog-tabs'
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

const PUBLIC_CREATOR_CENTER_URL = 'https://creators.dify.ai/'

const getCreatorCenterUrl = (marketplaceUrlPrefix: string) => {
  if (!marketplaceUrlPrefix) return PUBLIC_CREATOR_CENTER_URL

  try {
    const marketplaceUrl = new URL(marketplaceUrlPrefix)
    const [service, ...domain] = marketplaceUrl.hostname.split('.')
    if (!service?.startsWith('marketplace') || domain.length === 0)
      return PUBLIC_CREATOR_CENTER_URL

    marketplaceUrl.hostname = [service.replace(/^marketplace/, 'creators'), ...domain].join('.')
    marketplaceUrl.pathname = '/'
    marketplaceUrl.search = ''
    marketplaceUrl.hash = ''
    return marketplaceUrl.toString()
  }
  catch {
    return PUBLIC_CREATOR_CENTER_URL
  }
}

const CreatorCenter = () => {
  const creatorCenterUrl = getCreatorCenterUrl(MARKETPLACE_URL_PREFIX)

  return (
    <Link href={creatorCenterUrl} target="_blank" rel="noopener noreferrer">
      <Button
        variant="ghost"
        className="flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
      >
        <span aria-hidden className="i-ri-user-star-line size-4" />
        <span className="hidden system-sm-medium lg:inline">Creator Center</span>
      </Button>
    </Link>
  )
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
      className={cn(
        'sticky top-0 z-50 flex w-full shrink-0 items-center gap-4 border-b border-divider-regular bg-background-default px-4 py-1.5 md:px-9',
        styles.header,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link
          href="/"
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
        <CreatorCenter />
        <HomeGuide isMarketplacePlatform={isMarketplacePlatform} />
        {actions}
      </div>
    </header>
  )
}

export default HomeHeader
