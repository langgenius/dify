import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { getMarketplaceUrl } from '@/utils/var'
import { modelNameMap, providerIconMap } from '../utils'

type MarketplaceSectionProps = {
  marketplaceProviders: ModelProviderQuotaGetPaid[]
  marketplaceCollapsed: boolean
  installingProvider: ModelProviderQuotaGetPaid | null
  isMarketplacePluginsLoading: boolean
  theme?: string
  onMarketplaceCollapsedChange: (collapsed: boolean) => void
  onInstallPlugin: (key: ModelProviderQuotaGetPaid) => void | Promise<void>
}

function MarketplaceSection({
  marketplaceProviders,
  marketplaceCollapsed,
  installingProvider,
  isMarketplacePluginsLoading,
  theme,
  onMarketplaceCollapsedChange,
  onInstallPlugin,
}: MarketplaceSectionProps) {
  const { t } = useTranslation()

  if (marketplaceProviders.length === 0)
    return null

  return (
    <>
      <div className="py-2">
        <div className="h-px bg-divider-subtle" />
      </div>
      <div>
        <div className="flex h-5.5 items-center pr-2 pl-4">
          <button
            type="button"
            className="flex flex-1 cursor-pointer items-center border-0 bg-transparent p-0 text-left system-sm-medium text-text-primary"
            onClick={() => onMarketplaceCollapsedChange(!marketplaceCollapsed)}
          >
            {t('modelProvider.selector.fromMarketplace', { ns: 'common' })}
            <span className={cn('i-custom-vender-solid-general-arrow-down-round-fill h-4 w-4 text-text-quaternary', marketplaceCollapsed && '-rotate-90')} />
          </button>
        </div>
        {!marketplaceCollapsed && (
          <div className="px-1 pb-1">
            {marketplaceProviders.map((key) => {
              const Icon = providerIconMap[key]
              const isInstalling = installingProvider === key
              return (
                <div
                  key={key}
                  className="group flex cursor-pointer items-center gap-1 rounded-lg py-0.5 pr-0.5 pl-3 hover:bg-state-base-hover"
                >
                  <div className="flex flex-1 items-center gap-2 py-0.5">
                    <Icon className="h-5 w-5 shrink-0 rounded-md" />
                    <span className="system-sm-regular text-text-secondary">{modelNameMap[key]}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="small"
                    className={cn(
                      'shrink-0 backdrop-blur-[5px]',
                      !isInstalling && 'hidden group-hover:flex',
                    )}
                    disabled={isInstalling || isMarketplacePluginsLoading}
                    onClick={() => onInstallPlugin(key)}
                  >
                    {isInstalling && <span className="i-ri-loader-2-line h-3.5 w-3.5 animate-spin" />}
                    {isInstalling
                      ? t('installModal.installing', { ns: 'plugin' })
                      : t('modelProvider.selector.install', { ns: 'common' })}
                  </Button>
                </div>
              )
            })}
            <a
              className="flex cursor-pointer items-center gap-0.5 px-3 py-1.5"
              href={getMarketplaceUrl('', { theme })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="flex-1 system-xs-regular text-text-accent">
                {t('modelProvider.selector.discoverMoreInMarketplace', { ns: 'common' })}
              </span>
              <span className="i-ri-arrow-right-up-line h-3! w-3! text-text-accent" />
            </a>
          </div>
        )}
      </div>
    </>
  )
}

export default MarketplaceSection
