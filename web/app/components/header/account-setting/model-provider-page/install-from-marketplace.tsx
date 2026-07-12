import type { ModelProvider } from './declarations'
import type { Plugin } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTheme } from 'next-themes'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import List from '@/app/components/plugins/marketplace/list'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import ProviderCard from '@/app/components/plugins/provider-card'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import Link from '@/next/link'
import { useMarketplaceAllPlugins } from './hooks'

type InstallFromMarketplaceProps = {
  onOpenMarketplace?: () => void
  providers: ModelProvider[]
  searchText: string
}
const InstallFromMarketplace = ({
  onOpenMarketplace,
  providers,
  searchText,
}: InstallFromMarketplaceProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { canInstallPlugin } = usePluginSettingsAccess()
  const [collapse, setCollapse] = useState(false)
  const { plugins: allPlugins, isLoading: isAllPluginsLoading } = useMarketplaceAllPlugins(
    providers,
    searchText,
  )

  const cardRender = useCallback((plugin: Plugin) => {
    if (plugin.type === 'bundle') return null

    return <ProviderCard key={plugin.plugin_id} className="h-[146px]" payload={plugin} />
  }, [])

  return (
    <div id="model-provider-marketplace" className="flex scroll-mt-4 flex-col gap-2">
      <Divider className="my-2! h-px" />
      <div className="flex h-5 items-center justify-between">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left system-md-semibold text-text-primary"
          onClick={() => setCollapse((prev) => !prev)}
          aria-expanded={!collapse}
        >
          <span className={cn('i-ri-arrow-down-s-line size-4', collapse && '-rotate-90')} />
          {t(($) => $['modelProvider.installProvider'], { ns: 'common' })}
        </button>
        <div className="flex items-center gap-1">
          <span className="system-sm-regular text-text-tertiary">
            {t(($) => $['modelProvider.discoverMore'], { ns: 'common' })}
          </span>
          {onOpenMarketplace ? (
            <button
              type="button"
              className="inline-flex items-center border-0 bg-transparent p-0 system-sm-medium text-text-accent"
              onClick={onOpenMarketplace}
            >
              {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
              <span className="i-ri-arrow-right-up-line size-4" aria-hidden="true" />
            </button>
          ) : (
            <Link
              target="_blank"
              rel="noopener noreferrer"
              href={getMarketplaceCategoryUrl(PluginCategoryEnum.model, { theme })}
              className="inline-flex items-center system-sm-medium text-text-accent"
            >
              {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
              <span className="i-ri-arrow-right-up-line size-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
      {!collapse && isAllPluginsLoading && <Loading type="area" />}
      {!isAllPluginsLoading && !collapse && (
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={allPlugins}
          showInstallButton={canInstallPlugin}
          cardContainerClassName="grid grid-cols-3 gap-2"
          cardRender={cardRender}
          emptyClassName="h-auto"
        />
      )}
    </div>
  )
}

export default InstallFromMarketplace
