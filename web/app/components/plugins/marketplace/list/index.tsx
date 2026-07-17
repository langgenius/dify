'use client'
import type { MarketplaceCollection, SearchParamsFromCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo } from 'react'
import { PluginInstallPermissionProviderGuard } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { useOptionalPluginInstallPermission } from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import Empty from '../empty'
import CardWrapper from './card-wrapper'
import ListWithCollection from './list-with-collection'

type ListProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  plugins?: Plugin[]
  showInstallButton?: boolean
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
  emptyClassName?: string
  onCollectionMoreClick?: (searchParams?: SearchParamsFromCollection) => void
}
const List = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  plugins,
  showInstallButton,
  cardContainerClassName,
  cardRender,
  emptyClassName,
  onCollectionMoreClick,
}: ListProps) => {
  const { canInstallPlugin } = useOptionalPluginInstallPermission()
  const pluginIds = useMemo(() => {
    const ids = new Set<string>()
    const addPluginId = (plugin: Plugin) => ids.add(plugin.plugin_id)

    if (plugins) plugins.forEach(addPluginId)
    else
      Object.values(marketplaceCollectionPluginsMap).forEach((collectionPlugins) => {
        collectionPlugins.forEach(addPluginId)
      })

    return [...ids].sort()
  }, [marketplaceCollectionPluginsMap, plugins])

  const shouldCheckInstalled =
    !!showInstallButton && canInstallPlugin && !cardRender && pluginIds.length > 0
  const { installedInfo } = useCheckInstalled({
    pluginIds,
    enabled: shouldCheckInstalled,
  })
  const installedPluginIds = useMemo(
    () => new Set(Object.keys(installedInfo ?? {})),
    [installedInfo],
  )

  return (
    <PluginInstallPermissionProviderGuard canInstallPlugin={!!showInstallButton}>
      {!plugins && (
        <ListWithCollection
          marketplaceCollections={marketplaceCollections}
          marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
          showInstallButton={showInstallButton}
          cardContainerClassName={cardContainerClassName}
          cardRender={cardRender}
          onCollectionMoreClick={onCollectionMoreClick}
          installedPluginIds={installedPluginIds}
        />
      )}
      {plugins && !!plugins.length && (
        <div className={cn('grid grid-cols-4 gap-3', cardContainerClassName)}>
          {plugins.map((plugin) => {
            if (cardRender) return cardRender(plugin)

            return (
              <CardWrapper
                key={`${plugin.org}/${plugin.name}`}
                plugin={plugin}
                showInstallButton={showInstallButton}
                isInstalled={installedPluginIds.has(plugin.plugin_id)}
              />
            )
          })}
        </div>
      )}
      {plugins && !plugins.length && <Empty className={emptyClassName} />}
    </PluginInstallPermissionProviderGuard>
  )
}

export default List
