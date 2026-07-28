import type { HomeCatalogTab } from './home-catalog-tabs'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import MarketplaceLogoDark from '@/public/marketplace/dify-marketplace-logo-dark.svg'
import MarketplaceLogo from '@/public/marketplace/dify-marketplace-logo.svg'
import HomeCatalogTabs from './home-catalog-tabs'
import { HomeStickyCatalogTabs } from './home-sticky-state-provider'
import styles from './home-sticky.module.css'

type HomeHeaderProps = {
  activeTab?: HomeCatalogTab
  actions?: React.ReactNode
  isMarketplacePlatform: boolean
}

function Guide() {
  const docLink = useDocLink()
  const { t } = useTranslation('plugin')

  return (
    <Link href={docLink()} target="_blank" rel="noopener noreferrer" className={styles.guide}>
      <Button variant="ghost" size="large" className="min-w-[94px] gap-0.5 px-3 text-text-primary">
        <span aria-hidden className="i-ri-map-2-line size-5" />
        <span className="px-1 system-md-medium">{t(($) => $['marketplace.home.guide'])}</span>
      </Button>
    </Link>
  )
}

const HomeHeader = ({ activeTab = 'plugins', actions, isMarketplacePlatform }: HomeHeaderProps) => {
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
          />
        </HomeStickyCatalogTabs>
      </div>

      <div className="flex h-full min-w-0 flex-1 items-center justify-end gap-2.5">
        <Guide />
        {actions}
      </div>
    </header>
  )
}

export default HomeHeader
