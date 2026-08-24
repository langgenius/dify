import type { PluginBanner } from '@dify/contracts/marketplace'
import type { ReactNode } from 'react'
import type { MarketplaceBannerPage } from './banners'
import { cn } from '@langgenius/dify-ui/cn'
import { HomeStickyStateProvider } from './home-sticky-state-provider'
import styles from './home-sticky.module.css'
import HomeTrending from './home-trending'

type HomeShellProps = {
  banners: PluginBanner[]
  children: ReactNode
  header: ReactNode
  hero: ReactNode
  isMarketplacePlatform: boolean
  navigation: ReactNode
  page: MarketplaceBannerPage
  search: ReactNode
}

/**
 * Shared scaffold for the marketplace catalog homes (Plugins and Templates):
 * sticky header, hero, floating search, the optional trending banners, and
 * the sticky catalog navigation above the page content. Keeping the structure
 * in one place stops the two catalog pages from drifting apart.
 */
export function HomeShell({
  banners,
  children,
  header,
  hero,
  isMarketplacePlatform,
  navigation,
  page,
  search,
}: HomeShellProps) {
  return (
    <HomeStickyStateProvider>
      <div
        className="flex min-h-full w-full shrink-0 flex-col bg-background-default"
        data-marketplace-standalone={isMarketplacePlatform ? '' : undefined}
      >
        {header}
        <div className="relative flex w-full flex-col">
          {hero}
          {search}
          {banners.length > 0 && (
            <>
              <div
                aria-hidden="true"
                className={cn('h-12 shrink-0', isMarketplacePlatform && styles.bannerSpacer)}
              />
              <HomeTrending
                banners={banners}
                isMarketplacePlatform={isMarketplacePlatform}
                page={page}
              />
            </>
          )}
          {navigation}
          {children}
        </div>
      </div>
    </HomeStickyStateProvider>
  )
}
