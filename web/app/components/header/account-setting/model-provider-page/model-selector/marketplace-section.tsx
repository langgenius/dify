import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { modelNameMap, providerIconMap } from '../utils'

type MarketplaceSectionProps = {
  marketplaceProviders: ModelProviderQuotaGetPaid[]
  marketplaceCollapsed: boolean
  installingProvider: ModelProviderQuotaGetPaid | null
  canInstallPlugin: boolean
  theme?: string
  onMarketplaceCollapsedChange: (collapsed: boolean) => void
  onInstallPlugin: (key: ModelProviderQuotaGetPaid) => void | Promise<void>
  onOpenMarketplace?: () => void
}

function MarketplaceSection({
  marketplaceProviders,
  marketplaceCollapsed,
  installingProvider,
  canInstallPlugin,
  theme,
  onMarketplaceCollapsedChange,
  onInstallPlugin,
  onOpenMarketplace,
}: MarketplaceSectionProps) {
  const { t } = useTranslation()
  const headingId = useId()

  if (marketplaceProviders.length === 0) return null

  return (
    <>
      <div className="py-2">
        <div className="h-px bg-divider-subtle" />
      </div>
      <Collapsible
        open={!marketplaceCollapsed}
        onOpenChange={(open) => onMarketplaceCollapsedChange(!open)}
        render={<section aria-labelledby={headingId} />}
      >
        <div className="flex h-5.5 items-center pr-2 pl-4">
          <CollapsibleTrigger
            id={headingId}
            className="group/marketplace min-h-0 flex-1 justify-start gap-0 rounded-none p-0 system-sm-medium text-text-primary hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-primary data-panel-open:text-text-primary"
          >
            {t(($) => $['modelProvider.selector.fromMarketplace'], { ns: 'common' })}
            <span
              aria-hidden="true"
              className={cn(
                'i-custom-vender-solid-general-arrow-down-round-fill size-4 -rotate-90 text-text-quaternary transition-transform group-data-panel-open/marketplace:rotate-0 motion-reduce:transition-none',
              )}
            />
          </CollapsibleTrigger>
        </div>
        <CollapsiblePanel>
          <ul className="px-1 pb-1">
            {marketplaceProviders.map((key) => {
              const Icon = providerIconMap[key]
              const isInstalling = installingProvider === key
              return (
                <li
                  key={key}
                  className="group flex cursor-pointer items-center gap-1 rounded-lg py-0.5 pr-0.5 pl-3 focus-within:bg-state-base-hover hover:bg-state-base-hover"
                >
                  <div className="flex flex-1 items-center gap-2 py-0.5">
                    <Icon aria-hidden="true" className="size-5 shrink-0 rounded-md" />
                    <span className="system-sm-regular text-text-secondary">
                      {modelNameMap[key]}
                    </span>
                  </div>
                  {canInstallPlugin && (
                    <Button
                      variant="secondary"
                      size="small"
                      aria-busy={isInstalling || undefined}
                      className={cn(
                        'shrink-0 backdrop-blur-[5px]',
                        !isInstalling &&
                          'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100',
                      )}
                      disabled={isInstalling}
                      onClick={() => onInstallPlugin(key)}
                    >
                      {isInstalling && (
                        <span
                          aria-hidden="true"
                          className="i-ri-loader-2-line size-3.5 animate-spin"
                        />
                      )}
                      {isInstalling
                        ? t(($) => $['installModal.installing'], { ns: 'plugin' })
                        : t(($) => $['modelProvider.selector.install'], { ns: 'common' })}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="px-1 pb-1">
            {onOpenMarketplace ? (
              <Button
                variant="ghost"
                size="small"
                className="h-auto w-full justify-start gap-0.5 px-3 py-1.5 text-left"
                onClick={onOpenMarketplace}
              >
                <span className="flex-1 system-xs-regular text-text-accent">
                  {t(($) => $['modelProvider.selector.discoverMoreInMarketplace'], {
                    ns: 'common',
                  })}
                </span>
                <span
                  className="i-ri-arrow-right-up-line size-3! text-text-accent"
                  aria-hidden="true"
                />
              </Button>
            ) : (
              <a
                className="flex cursor-pointer items-center gap-0.5 rounded-md px-3 py-1.5 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                href={getMarketplaceCategoryUrl(PluginCategoryEnum.model, { theme })}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="flex-1 system-xs-regular text-text-accent">
                  {t(($) => $['modelProvider.selector.discoverMoreInMarketplace'], {
                    ns: 'common',
                  })}
                </span>
                <span
                  className="i-ri-arrow-right-up-line size-3! text-text-accent"
                  aria-hidden="true"
                />
              </a>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </>
  )
}

export default MarketplaceSection
