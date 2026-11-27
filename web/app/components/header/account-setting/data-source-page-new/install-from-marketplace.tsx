import type { DatasourceProviderAuthResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { Plugin } from '@/app/components/plugins/types'
import type { MarketplaceLinks } from '@/features/marketplace/links'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import List from '@/app/components/plugins/marketplace/list'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import ProviderCard from '@/app/components/plugins/provider-card'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useResolvedTheme } from '@/features/theme/hooks'
import Link from '@/next/link'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { useMarketplaceAllPlugins } from './hooks'

type InstallFromMarketplaceProps = {
  marketplace: MarketplaceLinks
  onOpenMarketplace?: () => void
  providers: DatasourceProviderAuthResponse[]
  searchText: string
}
const InstallFromMarketplace = ({
  marketplace,
  onOpenMarketplace,
  providers,
  searchText,
}: InstallFromMarketplaceProps) => {
  const { t } = useTranslation(['plugin', 'modelProvider', 'common'])
  const theme = useResolvedTheme()
  const { canInstallPlugin } = usePluginSettingsAccess()
  const [collapse, setCollapse] = useState(false)
  const {
    plugins: allPlugins,
    isLoading: isAllPluginsLoading,
    loadError,
    isRetrying,
    retryLoad,
  } = useMarketplaceAllPlugins(providers, searchText, !collapse)
  const loadErrorMessage = useRequestErrorMessage(
    loadError,
    t(($) => $['modelProvider.loadFailed'], { ns: 'modelProvider' }),
  )

  const cardRender = useCallback(
    (plugin: Plugin) => {
      if (plugin.type === 'bundle') return null

      return (
        <ProviderCard
          key={plugin.plugin_id}
          className="h-36.5"
          marketplace={marketplace}
          payload={plugin}
        />
      )
    },
    [marketplace],
  )

  return (
    <div className="mb-2">
      <Separator className="my-2 mt-4" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={!collapse}
          className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-start system-md-semibold text-text-primary"
          onClick={() => setCollapse(!collapse)}
        >
          <span
            className={cn('i-ri-arrow-down-s-line size-4', collapse && '-rotate-90')}
            aria-hidden="true"
          />
          {t(($) => $['modelProvider.installDataSource'], { ns: 'modelProvider' })}
        </button>
        <div className="mb-2 flex flex-wrap items-center pt-2">
          <span className="pe-1 system-sm-regular text-text-tertiary">
            {t(($) => $['modelProvider.discoverMore'], { ns: 'modelProvider' })}
          </span>
          {onOpenMarketplace ? (
            <button
              type="button"
              className="inline-flex items-center border-0 bg-transparent p-0 system-sm-medium text-text-accent"
              onClick={onOpenMarketplace}
            >
              {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
              <span
                className="i-ri-arrow-right-up-line size-4 rtl:-scale-x-100"
                aria-hidden="true"
              />
            </button>
          ) : (
            <Link
              target="_blank"
              rel="noopener noreferrer"
              href={marketplace.category(PluginCategoryEnum.datasource, { theme })}
              className="inline-flex items-center system-sm-medium text-text-accent"
            >
              {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
              <span
                className="i-ri-arrow-right-up-line size-4 rtl:-scale-x-100"
                aria-hidden="true"
              />
            </Link>
          )}
        </div>
      </div>
      {!isAllPluginsLoading && !collapse && loadErrorMessage && (
        <Alert type="error">
          <AlertTitle>{loadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button size="small" loading={isRetrying} onClick={retryLoad}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      )}
      {!!searchText.trim() && !isAllPluginsLoading && !collapse && !loadErrorMessage && (
        <div role="status" className="sr-only">
          {t(($) => $['modelProvider.installDataSource'], { ns: 'modelProvider' })}
          {': '}
          {t(($) => $['marketplace.pluginsResult'], {
            ns: 'plugin',
            num: allPlugins.filter((plugin) => plugin.type !== 'bundle').length,
          })}
        </div>
      )}
      {!collapse && isAllPluginsLoading && <LoadingPlaceholder />}
      {/* With a failed load, an empty list would read as nothing to install. */}
      {!isAllPluginsLoading && !collapse && (!loadErrorMessage || allPlugins.length > 0) && (
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={allPlugins}
          showInstallButton={canInstallPlugin}
          cardContainerClassName="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          cardRender={cardRender}
          emptyClassName="h-auto"
        />
      )}
    </div>
  )
}

export default memo(InstallFromMarketplace)
