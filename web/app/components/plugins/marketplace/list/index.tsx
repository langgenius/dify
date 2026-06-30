'use client'
import type { Plugin } from '../../types'
import type { MarketplaceCollection, SearchParamsFromCollection } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { PluginInstallPermissionProviderGuard } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
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
  return (
    <PluginInstallPermissionProviderGuard canInstallPlugin={!!showInstallButton}>
      {
        !plugins && (
          <ListWithCollection
            marketplaceCollections={marketplaceCollections}
            marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
            showInstallButton={showInstallButton}
            cardContainerClassName={cardContainerClassName}
            cardRender={cardRender}
            onCollectionMoreClick={onCollectionMoreClick}
          />
        )
      }
      {
        plugins && !!plugins.length && (
          <div className={cn(
            'grid grid-cols-4 gap-3',
            cardContainerClassName,
          )}
          >
            {
              plugins.map((plugin) => {
                if (cardRender)
                  return cardRender(plugin)

                return (
                  <CardWrapper
                    key={`${plugin.org}/${plugin.name}`}
                    plugin={plugin}
                    showInstallButton={showInstallButton}
                  />
                )
              })
            }
          </div>
        )
      }
      {
        plugins && !plugins.length && (
          <Empty className={emptyClassName} />
        )
      }
    </PluginInstallPermissionProviderGuard>
  )
}

export default List
