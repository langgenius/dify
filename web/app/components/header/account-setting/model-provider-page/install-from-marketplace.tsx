import type { Plugin } from '@/app/components/plugins/types'
import type { MarketplaceLinks } from '@/features/marketplace/links'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import List from '@/app/components/plugins/marketplace/list'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import ProviderCard from '@/app/components/plugins/provider-card'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useResolvedTheme } from '@/features/theme/hooks'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { useMarketplaceAllPlugins } from './hooks'

type InstallFromMarketplaceProps = {
  marketplace: MarketplaceLinks
  onOpenMarketplace?: () => void
  searchText: string
  stepByStepTourTarget?: string
}
const InstallFromMarketplace = ({
  marketplace,
  onOpenMarketplace,
  searchText,
  stepByStepTourTarget,
}: InstallFromMarketplaceProps) => {
  const { t } = useTranslation(['common', 'plugin', 'modelProvider'])
  const theme = useResolvedTheme()
  const { canInstallPlugin } = usePluginSettingsAccess()
  const [collapse, setCollapse] = useState(false)
  const [hasEnteredViewport, setHasEnteredViewport] = useState(
    () => !globalThis.IntersectionObserver,
  )
  const [hasBeenReopened, setHasBeenReopened] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)
  const shouldLoadMarketplace = !collapse && (hasEnteredViewport || !!searchText || hasBeenReopened)
  const installedPluginIdsQuery = useQuery({
    ...consoleQuery.workspaces.current.plugin.installedIds.get.queryOptions({
      input: { query: { category: 'model' } },
      enabled: shouldLoadMarketplace,
    }),
    select: (data) => data.plugin_ids,
  })
  const { data: installedPluginIds, isSuccess: hasLoadedInstalledPluginIds } =
    installedPluginIdsQuery
  const installedPluginIdsLoad = useOwnedQueryErrors(collapse ? [] : [installedPluginIdsQuery])
  const installedPluginIdsErrorMessage = useRequestErrorMessage(
    installedPluginIdsLoad?.error,
    t(($) => $['modelProvider.loadFailed'], { ns: 'modelProvider' }),
  )
  const {
    plugins: allPlugins,
    isLoading: isAllPluginsLoading,
    loadError: pluginsLoadError,
    isRetrying: isRetryingPlugins,
    retryLoad: retryPlugins,
  } = useMarketplaceAllPlugins(
    searchText,
    installedPluginIds ?? [],
    shouldLoadMarketplace && hasLoadedInstalledPluginIds,
  )
  const pluginsLoadErrorMessage = useRequestErrorMessage(
    pluginsLoadError,
    t(($) => $['modelProvider.loadFailed'], { ns: 'modelProvider' }),
  )

  useEffect(() => {
    const section = sectionRef.current
    if (!section || hasEnteredViewport) return

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      setHasEnteredViewport(true)
      observer.disconnect()
    })
    observer.observe(section)
    return () => observer.disconnect()
  }, [hasEnteredViewport])

  const handleToggle = () => {
    setCollapse((previous) => {
      if (previous) setHasBeenReopened(true)
      return !previous
    })
  }

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
    <div
      ref={sectionRef}
      id="model-provider-marketplace"
      className="flex scroll-mt-4 flex-col gap-2"
    >
      <Separator className="my-2" />
      <div className="relative flex flex-col gap-2">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-43.5"
          data-step-by-step-tour-target={stepByStepTourTarget}
        />
        <div className="flex h-5 items-center justify-between">
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-start system-md-semibold text-text-primary"
            onClick={handleToggle}
            aria-expanded={!collapse}
          >
            <span
              className={cn(
                'i-ri-arrow-down-s-line size-4',
                collapse && '-rotate-90 rtl:rotate-90',
              )}
            />
            {t(($) => $['modelProvider.installProvider'], { ns: 'modelProvider' })}
          </button>
          <div className="flex items-center gap-1">
            <span className="system-sm-regular text-text-tertiary">
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
                  className="i-ri-arrow-right-up-line size-4 [&:dir(rtl)]:-scale-x-100"
                  aria-hidden="true"
                />
              </button>
            ) : (
              <Link
                target="_blank"
                rel="noopener noreferrer"
                href={marketplace.category(PluginCategoryEnum.model, { theme })}
                className="inline-flex items-center system-sm-medium text-text-accent"
              >
                {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
                <span
                  className="i-ri-arrow-right-up-line size-4 [&:dir(rtl)]:-scale-x-100"
                  aria-hidden="true"
                />
              </Link>
            )}
          </div>
        </div>
        {!collapse && installedPluginIdsLoad && (
          <Alert type="error">
            <AlertTitle>{installedPluginIdsErrorMessage}</AlertTitle>
            <AlertActions>
              <Button
                size="small"
                loading={installedPluginIdsLoad.retrying}
                onClick={installedPluginIdsLoad.retry}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        )}
        {!collapse &&
          shouldLoadMarketplace &&
          !hasLoadedInstalledPluginIds &&
          !installedPluginIdsLoad && <LoadingPlaceholder />}
        {!collapse && hasLoadedInstalledPluginIds && isAllPluginsLoading && <LoadingPlaceholder />}
        {!isAllPluginsLoading &&
          !collapse &&
          hasLoadedInstalledPluginIds &&
          pluginsLoadErrorMessage && (
            <Alert type="error">
              <AlertTitle>{pluginsLoadErrorMessage}</AlertTitle>
              <AlertActions>
                <Button size="small" loading={isRetryingPlugins} onClick={retryPlugins}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </AlertActions>
            </Alert>
          )}
        {/* With a failed load, an empty list would read as nothing to install. */}
        {!isAllPluginsLoading &&
          !collapse &&
          hasLoadedInstalledPluginIds &&
          (!pluginsLoadErrorMessage || !!allPlugins?.length) && (
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
    </div>
  )
}

export default InstallFromMarketplace
