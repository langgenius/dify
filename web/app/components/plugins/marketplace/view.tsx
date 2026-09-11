import type { PluginBanner } from '@dify/contracts/marketplace'
import type { ActivePluginType } from './constants'
import type { HomeCatalogTabLabels } from './home/home-catalog-tabs'
import { PluginInstallPermissionProviderGuard } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import Description from './description'
import MarketplaceHome from './home'
import ListWrapper from './list/list-wrapper'
import StickySearchAndSwitchWrapper from './sticky-search-and-switch-wrapper'

type MarketplaceVariant = 'default' | 'home'

export type MarketplaceViewProps = {
  banners: PluginBanner[]
  showInstallButton?: boolean
  linkToMarketplaceDetail?: boolean
  pluginTypeSwitchClassName?: string
  isMarketplacePlatform?: boolean
  marketplaceNav?: React.ReactNode
  variant?: MarketplaceVariant
  homeHeaderActions?: React.ReactNode
  homeCatalogLabels?: HomeCatalogTabLabels
  homeCatalogCategories?: React.ReactNode
  homeActivePluginType?: ActivePluginType
  homeSearch?: React.ReactNode
  language?: string
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
  homeCatalogLabels,
  homeCatalogCategories,
  homeActivePluginType,
  homeSearch,
  language,
}: MarketplaceViewProps) {
  return (
    <PluginInstallPermissionProviderGuard canInstallPlugin={showInstallButton}>
      {variant === 'home' ? (
        <MarketplaceHome
          actions={homeHeaderActions}
          activePluginType={homeActivePluginType}
          banners={banners}
          catalogCategories={homeCatalogCategories}
          catalogLabels={homeCatalogLabels}
          search={homeSearch}
          isMarketplacePlatform={isMarketplacePlatform}
          language={language}
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
