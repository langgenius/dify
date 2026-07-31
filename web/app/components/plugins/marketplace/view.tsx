import type { PluginBanner } from './home/banners'
import { PluginInstallPermissionProviderGuard } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import Description from './description'
import MarketplaceHome from './home'
import ListWrapper from './list/list-wrapper'
import StickySearchAndSwitchWrapper from './sticky-search-and-switch-wrapper'

export type MarketplaceVariant = 'default' | 'home'

export type MarketplaceViewProps = {
  banners: PluginBanner[]
  showInstallButton?: boolean
  linkToMarketplaceDetail?: boolean
  pluginTypeSwitchClassName?: string
  isMarketplacePlatform?: boolean
  marketplaceNav?: React.ReactNode
  variant?: MarketplaceVariant
  homeHeaderActions?: React.ReactNode
}

export function MarketplaceView({
  banners,
  showInstallButton = false,
  linkToMarketplaceDetail = false,
  pluginTypeSwitchClassName,
  isMarketplacePlatform = false,
  marketplaceNav,
  variant = 'default',
  homeHeaderActions,
}: MarketplaceViewProps) {
  return (
    <PluginInstallPermissionProviderGuard canInstallPlugin={showInstallButton}>
      {variant === 'home' ? (
        <MarketplaceHome
          actions={homeHeaderActions}
          banners={banners}
          isMarketplacePlatform={isMarketplacePlatform}
          linkToMarketplaceDetail={linkToMarketplaceDetail}
          showInstallButton={showInstallButton}
        />
      ) : (
        <>
          <Description
            isMarketplacePlatform={isMarketplacePlatform}
            marketplaceNav={marketplaceNav}
          />
          {!isMarketplacePlatform && (
            <StickySearchAndSwitchWrapper pluginTypeSwitchClassName={pluginTypeSwitchClassName} />
          )}
          <ListWrapper
            showInstallButton={showInstallButton}
            linkToMarketplaceDetail={linkToMarketplaceDetail}
          />
        </>
      )}
    </PluginInstallPermissionProviderGuard>
  )
}
